import type { ConvState, WaIncoming } from './whatsappBot'
import type { WaMessage } from './whatsapp'
import { interactiveOptions } from './whatsapp'
import { dbConfigured, ensureSchema, sql } from './db'
import { mediaPath, mediaPlaceholder } from './media'

/**
 * Repositorio de la BANDEJA DE ATENCIÓN HUMANA (tablas conversations/messages/media).
 * Lo usan los webhooks (registrar todo lo que entra y sale + estado del bot) y
 * los endpoints de /api/inbox (listar, leer, responder, tomar/devolver, archivar).
 *
 * Canal + external_id identifican al cliente: wa = número E.164 sin '+' O un
 * BSUID ("CO.1041…", identidad nueva de Meta sin teléfono), msg = PSID de
 * Messenger, ig = IGSID de Instagram. telefono/bsuid/username son datos de
 * contacto adicionales para mostrar en la bandeja.
 *
 * Las conversaciones NUNCA se borran: estado='cerrado' significa "Archivada"
 * (solo cambia de pestaña en la bandeja) y sigue consultable para remarketing.
 */

export type Canal = 'wa' | 'msg' | 'ig'
export type Estado = 'bot' | 'humano' | 'cerrado'

export interface ConversationRow {
  id: number
  canal: Canal
  external_id: string
  nombre: string | null
  ultimo_mensaje: string | null
  ultima_actividad: string
  ultimo_cliente_at: string | null
  estado: Estado
  no_leidos: number
  bot_state: Partial<ConvState>
  created_at: string
  /** última vez que pasó a estado=humano (para el auto-retorno al bot) */
  humano_at?: string | null
  /** WhatsApp: teléfono si Meta lo entregó (con BSUID puede no venir) */
  telefono?: string | null
  /** WhatsApp: Business-Scoped User ID (identidad nueva de Meta) */
  bsuid?: string | null
  /** WhatsApp: username del cliente (solo si activó la función) */
  username?: string | null
  archivada_at?: string | null
}

/** Tipo de mensaje guardado (columna messages.tipo). */
export type MessageTipo = 'text' | 'image' | 'sticker' | 'audio' | 'video' | 'document' | 'location' | 'contacts' | 'reaction' | 'unsupported'

export interface MessageMedia { url: string, mime: string, filename: string | null, bytes: number }
export interface MessageRow {
  id: number
  conversation_id: number
  direccion: 'in' | 'out'
  texto: string
  autor: string
  created_at: string
  wamid: string | null
  /** entrantes: cuándo se les envió respuesta con éxito (null = aún sin responder) */
  replied_at?: string | null
  tipo: MessageTipo
  media_id: number | null
  /** caption, filename, mime, lat/lng, download_failed, dry_run… */
  meta: Record<string, any> | null
  /** archivo asociado (resuelto desde la tabla media), null si no hay o no se pudo guardar */
  media: MessageMedia | null
}

export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

/** true si el cliente escribió hace menos de 24h (WhatsApp permite texto libre). */
export function windowOpen(ultimoClienteAt: string | null | undefined): boolean {
  if (!ultimoClienteAt) return false
  return Date.now() - new Date(ultimoClienteAt).getTime() < WA_WINDOW_MS
}

// ---------- fallback en memoria (sin POSTGRES_URL, p. ej. local sin BD) ----------
const memState = new Map<string, ConvState>()
const DEFAULT_STATE: ConvState = { step: 'start', flaggedForHuman: false, updatedAt: 0 }

// BIGSERIAL llega como string por el driver HTTP; se normaliza a number.
function normConv(r: any): ConversationRow {
  return { ...r, id: Number(r.id), no_leidos: Number(r.no_leidos) }
}
function normMsg(r: any): MessageRow {
  const { media_token, media_mime, media_filename, media_bytes, ...rest } = r
  // URL RELATIVA para la bandeja (mismo origen, funciona también en local); la
  // absoluta (mediaUrl) se usa solo al enviar a Meta.
  const media: MessageMedia | null = media_token
    ? { url: mediaPath(String(media_token)), mime: String(media_mime), filename: media_filename ?? null, bytes: Number(media_bytes) }
    : null
  return {
    ...rest,
    id: Number(r.id),
    conversation_id: Number(r.conversation_id),
    tipo: (r.tipo ?? 'text') as MessageTipo,
    media_id: r.media_id == null ? null : Number(r.media_id),
    meta: r.meta ?? null,
    media,
  }
}

async function ready(): Promise<boolean> {
  if (!dbConfigured()) return false
  try {
    await ensureSchema()
    return true
  }
  catch (err) {
    console.error('[inbox] BD no disponible — se usa memoria:', String((err as Error)?.message ?? err))
    return false
  }
}

export interface ContactInfo { nombre?: string, telefono?: string, bsuid?: string, username?: string }

/**
 * Busca o crea la conversación del cliente. Actualiza nombre/teléfono/BSUID/
 * username si llegan nuevos (COALESCE: un dato conocido nunca se pisa con null).
 */
export async function upsertConversation(canal: Canal, externalId: string, info: ContactInfo = {}): Promise<ConversationRow | null> {
  if (!await ready()) return null
  const rows = await sql().query(
    `INSERT INTO conversations (canal, external_id, nombre, telefono, bsuid, username)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (canal, external_id)
     DO UPDATE SET nombre   = COALESCE(EXCLUDED.nombre, conversations.nombre),
                   telefono = COALESCE(EXCLUDED.telefono, conversations.telefono),
                   bsuid    = COALESCE(EXCLUDED.bsuid, conversations.bsuid),
                   username = COALESCE(EXCLUDED.username, conversations.username)
     RETURNING *`,
    [canal, externalId, info.nombre || null, info.telefono || null, info.bsuid || null, info.username || null],
  ) as any[]
  return rows[0] ? normConv(rows[0]) : null
}

export async function getConversationById(id: number): Promise<ConversationRow | null> {
  if (!await ready()) return null
  const rows = await sql().query(`SELECT * FROM conversations WHERE id = $1`, [id]) as any[]
  return rows[0] ? normConv(rows[0]) : null
}

/**
 * Estado del bot (slots, stack, handoff…) — persistido en conversations.bot_state.
 * RESILIENCIA: si la BD falla A MITAD de consulta (Neon suspendido/caído), degrada
 * al Map en memoria en vez de lanzar — el bot debe responder siempre.
 */
export async function loadBotState(canal: Canal, externalId: string): Promise<ConvState> {
  const key = `${canal}:${externalId}`
  if (!await ready()) return memState.get(key) ?? DEFAULT_STATE
  try {
    const rows = await sql().query(
      `SELECT bot_state FROM conversations WHERE canal = $1 AND external_id = $2`,
      [canal, externalId],
    ) as Array<{ bot_state: Partial<ConvState> }>
    const st = rows[0]?.bot_state
    if (!st || typeof st !== 'object' || !('step' in st)) return DEFAULT_STATE
    return { ...DEFAULT_STATE, ...st }
  }
  catch (err) {
    console.error(`[inbox] ⚠️ BD falló leyendo bot_state (${key}) — se usa memoria:`, String((err as Error)?.message ?? err))
    return memState.get(key) ?? DEFAULT_STATE
  }
}

export async function saveBotState(canal: Canal, externalId: string, patch: Partial<ConvState>): Promise<void> {
  const key = `${canal}:${externalId}`
  const cur = await loadBotState(canal, externalId)
  // undefined en el patch = borrar la clave (JSON.stringify la omite al persistir).
  const next: ConvState = { ...cur, ...patch, updatedAt: Date.now() }
  if (!await ready()) {
    memState.set(key, next)
    return
  }
  try {
    await sql().query(
      `INSERT INTO conversations (canal, external_id, bot_state) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (canal, external_id) DO UPDATE SET bot_state = EXCLUDED.bot_state`,
      [canal, externalId, JSON.stringify(next)],
    )
  }
  catch (err) {
    memState.set(key, next) // que al menos esta instancia caliente recuerde el estado
    console.error(`[inbox] ⚠️ BD falló guardando bot_state (${key}) — queda en memoria:`, String((err as Error)?.message ?? err))
  }
}

export interface RecordMessageInput {
  conversationId: number
  direccion: 'in' | 'out'
  texto: string
  autor: string // 'cliente' | 'bot' | 'agente'
  wamid?: string | null
  tipo?: MessageTipo
  mediaId?: number | null
  meta?: Record<string, unknown> | null
}

/** Guarda un mensaje y actualiza la cabecera de la conversación (último mensaje, actividad, no leídos). */
export async function recordMessage(m: RecordMessageInput): Promise<MessageRow | null> {
  if (!await ready()) return null
  const texto = m.texto.trim()
  if (!texto) return null
  const q = sql()
  const rows = await q.query(
    `INSERT INTO messages (conversation_id, direccion, texto, autor, wamid, tipo, media_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (wamid) WHERE wamid IS NOT NULL DO NOTHING
     RETURNING *`,
    [m.conversationId, m.direccion, texto, m.autor, m.wamid || null, m.tipo ?? 'text', m.mediaId ?? null, m.meta ? JSON.stringify(m.meta) : null],
  ) as any[]
  const row = rows[0] ? normMsg(rows[0]) : undefined
  if (!row) return null // reintento de Meta (mismo wamid) → ya estaba guardado
  const preview = texto.length > 160 ? `${texto.slice(0, 157)}…` : texto
  if (m.direccion === 'in') {
    await q.query(
      `UPDATE conversations
       SET ultimo_mensaje = $2, ultima_actividad = now(), ultimo_cliente_at = now(), no_leidos = no_leidos + 1
       WHERE id = $1`,
      [m.conversationId, preview],
    )
  }
  else {
    await q.query(
      `UPDATE conversations SET ultimo_mensaje = $2, ultima_actividad = now() WHERE id = $1`,
      [m.conversationId, preview],
    )
  }
  return row
}

/** Asocia (o marca como fallido) el archivo de un mensaje ya guardado; mezcla meta. */
export async function attachMedia(messageId: number, mediaId: number | null, metaPatch: Record<string, unknown> = {}): Promise<void> {
  if (!await ready()) return
  await sql().query(
    `UPDATE messages SET media_id = COALESCE($2, media_id), meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb WHERE id = $1`,
    [messageId, mediaId, JSON.stringify(metaPatch)],
  )
}

export async function setEstado(id: number, estado: Estado, opts: { markUnread?: boolean } = {}): Promise<void> {
  if (!await ready()) return
  await sql().query(
    `UPDATE conversations
     SET estado = $2,
         humano_at = CASE WHEN $2 = 'humano' THEN now() ELSE humano_at END,
         archivada_at = CASE WHEN $2 = 'cerrado' THEN now() ELSE NULL END,
         no_leidos = CASE WHEN $3::boolean THEN GREATEST(no_leidos, 1) ELSE no_leidos END
     WHERE id = $1`,
    [id, estado, !!opts.markUnread],
  )
}

export const HUMAN_TIMEOUT_MIN = 30

/**
 * AUTO-RETORNO AL BOT: si la conversación lleva >30 min en estado=humano sin que
 * ningún agente haya escrito, vuelve a manos del bot (y limpia flaggedForHuman en
 * bot_state) para que el cliente no quede hablando al vacío. Atómico en BD: solo
 * una instancia serverless "gana" el retorno. Devuelve true si se devolvió.
 */
export async function autoReturnToBot(id: number): Promise<boolean> {
  if (!await ready()) return false
  const rows = await sql().query(
    `UPDATE conversations c
     SET estado = 'bot', bot_state = c.bot_state || '{"flaggedForHuman": false}'::jsonb
     WHERE c.id = $1 AND c.estado = 'humano'
       AND COALESCE(c.humano_at, c.created_at) < now() - ($2 || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         WHERE m.conversation_id = c.id AND m.autor = 'agente'
           AND m.created_at > now() - ($2 || ' minutes')::interval
       )
     RETURNING id`,
    [id, String(HUMAN_TIMEOUT_MIN)],
  ) as any[]
  return rows.length > 0
}

/** Devuelve TODAS las conversaciones en humano al bot ya (endpoint de emergencia). */
export async function resetAllHumanToBot(): Promise<number[]> {
  if (!await ready()) return []
  const rows = await sql().query(
    `UPDATE conversations
     SET estado = 'bot', bot_state = bot_state || '{"flaggedForHuman": false}'::jsonb
     WHERE estado = 'humano'
     RETURNING id`,
  ) as any[]
  return rows.map(r => Number(r.id))
}

/** Busca un entrante ya guardado por su wamid (para decidir el dedupe de reintentos). */
export async function getMessageByWamid(wamid: string): Promise<MessageRow | null> {
  if (!await ready()) return null
  const rows = await sql().query(`SELECT * FROM messages WHERE wamid = $1`, [wamid]) as any[]
  return rows[0] ? normMsg(rows[0]) : null
}

/** Marca un entrante como RESPONDIDO CON ÉXITO (solo entonces el dedupe salta reintentos). */
export async function markWamidReplied(wamid: string): Promise<void> {
  if (!await ready()) return
  await sql().query(`UPDATE messages SET replied_at = now() WHERE wamid = $1`, [wamid])
}

export const ALERT_COOLDOWN_MIN = 30

/**
 * Anti-spam de avisos al equipo (correo + WhatsApp al encargado): reclama el
 * turno de aviso de una conversación si el último fue hace >30 min (o nunca).
 * Atómico en BD (UPDATE condicional) → vale entre instancias serverless.
 * Sin BD devuelve true (mejor un aviso de más que ninguno).
 */
export async function claimHandoffAlert(id: number): Promise<boolean> {
  if (!await ready()) return true
  const rows = await sql().query(
    `UPDATE conversations SET ultimo_aviso_at = now()
     WHERE id = $1 AND (ultimo_aviso_at IS NULL OR ultimo_aviso_at < now() - ($2 || ' minutes')::interval)
     RETURNING id`,
    [id, String(ALERT_COOLDOWN_MIN)],
  ) as any[]
  return rows.length > 0
}

export async function markRead(id: number): Promise<void> {
  if (!await ready()) return
  await sql().query(`UPDATE conversations SET no_leidos = 0 WHERE id = $1`, [id])
}

export type ListFilter = 'activas' | 'archivadas' | 'todas'
export interface ListOptions {
  /** busca en nombre, número, BSUID, username Y en el texto de todos los mensajes (histórico) */
  q?: string
  filter?: ListFilter
  /** rango sobre ultima_actividad (ISO); `hasta` es exclusivo */
  desde?: string | null
  hasta?: string | null
  limit?: number
}

/**
 * Lista de conversaciones (más recientes arriba). Nunca se ocultan por antigüedad:
 * sin filtros devuelve TODAS las activas (hasta `limit`, 500 por defecto).
 */
export async function listConversations(opts: ListOptions = {}): Promise<ConversationRow[]> {
  if (!await ready()) return []
  const q = (opts.q ?? '').trim()
  const filter: ListFilter = opts.filter ?? 'activas'
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000)
  const rows = await sql().query(
    `SELECT c.* FROM conversations c
     WHERE ($1 = 'todas' OR ($1 = 'archivadas' AND c.estado = 'cerrado') OR ($1 = 'activas' AND c.estado <> 'cerrado'))
       AND ($2::timestamptz IS NULL OR c.ultima_actividad >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR c.ultima_actividad <  $3::timestamptz)
       AND ($4 = '' OR c.nombre ILIKE $5 OR c.external_id ILIKE $5 OR c.telefono ILIKE $5 OR c.username ILIKE $5
            OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.texto ILIKE $5))
     ORDER BY c.ultima_actividad DESC
     LIMIT $6`,
    [filter, opts.desde || null, opts.hasta || null, q, `%${q}%`, limit],
  ) as any[]
  return rows.map(normConv)
}

export async function listMessages(conversationId: number, limit = 500): Promise<MessageRow[]> {
  if (!await ready()) return []
  const rows = await sql().query(
    `SELECT m.*, md.token AS media_token, md.mime AS media_mime, md.filename AS media_filename, md.bytes AS media_bytes
     FROM messages m
     LEFT JOIN media md ON md.id = m.media_id
     WHERE m.conversation_id = $1
     ORDER BY m.id DESC LIMIT $2`,
    [conversationId, limit],
  ) as any[]
  return rows.reverse().map(normMsg)
}

/** Texto plano legible de un WaMessage (para guardar en la bandeja lo que dijo el bot/agente). */
export function waMessageToText(m: WaMessage): string {
  if (m.type === 'text') return m.text.body
  if (m.type === 'image') return m.image.caption?.trim() || '[Imagen]'
  const it = m.interactive as any
  const parts: string[] = []
  if (it?.header?.text) parts.push(String(it.header.text))
  if (it?.body?.text) parts.push(String(it.body.text))
  const opts = interactiveOptions(m)
  if (opts?.length) parts.push(opts.map((o, i) => `${i + 1}. ${o.title}`).join('\n'))
  if (it?.footer?.text) parts.push(String(it.footer.text))
  return parts.join('\n\n')
}

type IncomingLike = Partial<WaIncoming> & { kind: string }

/** Texto legible de lo que escribió/tocó/envió el cliente (medios → caption o aviso). */
export function incomingToText(input: IncomingLike): string {
  if (input.kind === 'text') return input.text ?? ''
  if (input.kind === 'reply') return input.replyTitle || input.replyId || ''
  if (input.media) return input.media.caption?.trim() || mediaPlaceholder(input.media.kind, input.media.filename)
  if (input.location) {
    const l = input.location
    const label = [l.name, l.address].filter(Boolean).join(' · ')
    return `[Ubicación] ${label ? `${label} · ` : ''}${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`
  }
  if (input.contactsText) return `[Contacto compartido]\n${input.contactsText}`
  if (input.reaction) return `[Reacción ${input.reaction}]`
  return `[Mensaje no soportado${input.otherType ? `: ${input.otherType}` : ''}]`
}

/** Tipo (columna messages.tipo) de un entrante. */
export function incomingTipo(input: IncomingLike): MessageTipo {
  if (input.media) return input.media.kind
  if (input.location) return 'location'
  if (input.contactsText) return 'contacts'
  if (input.reaction) return 'reaction'
  if (input.kind === 'text' || input.kind === 'reply') return 'text'
  return 'unsupported'
}

/** Metadatos a guardar con el entrante (caption, archivo, coordenadas…). */
export function incomingMeta(input: IncomingLike): Record<string, unknown> | null {
  if (input.media) {
    const m = input.media
    return { caption: m.caption || undefined, filename: m.filename || undefined, mime: m.mime || undefined, wa_media_id: m.id || undefined }
  }
  if (input.location) return { ...input.location }
  if (input.reaction) return { emoji: input.reaction }
  if (input.kind === 'other' && input.otherType) return { tipo_original: input.otherType }
  return null
}
