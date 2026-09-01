import type { ConvState } from './whatsappBot'
import type { WaMessage } from './whatsapp'
import { interactiveOptions } from './whatsapp'
import { dbConfigured, ensureSchema, sql } from './db'

/**
 * Repositorio de la BANDEJA DE ATENCIÓN HUMANA (tablas conversations/messages).
 * Lo usan los webhooks (registrar todo lo que entra y sale + estado del bot) y
 * los endpoints de /api/inbox (listar, leer, responder, tomar/devolver).
 *
 * Canal + external_id identifican al cliente: wa = número E.164 sin '+',
 * msg = PSID de Messenger, ig = IGSID de Instagram.
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
}
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
  return { ...r, id: Number(r.id), conversation_id: Number(r.conversation_id) }
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

/** Busca o crea la conversación del cliente (actualiza nombre si llega uno nuevo). */
export async function upsertConversation(canal: Canal, externalId: string, nombre?: string): Promise<ConversationRow | null> {
  if (!await ready()) return null
  const rows = await sql().query(
    `INSERT INTO conversations (canal, external_id, nombre)
     VALUES ($1, $2, $3)
     ON CONFLICT (canal, external_id)
     DO UPDATE SET nombre = COALESCE(EXCLUDED.nombre, conversations.nombre)
     RETURNING *`,
    [canal, externalId, nombre || null],
  ) as any[]
  return rows[0] ? normConv(rows[0]) : null
}

export async function getConversationById(id: number): Promise<ConversationRow | null> {
  if (!await ready()) return null
  const rows = await sql().query(`SELECT * FROM conversations WHERE id = $1`, [id]) as any[]
  return rows[0] ? normConv(rows[0]) : null
}

/** Estado del bot (slots, stack, handoff…) — persistido en conversations.bot_state. */
export async function loadBotState(canal: Canal, externalId: string): Promise<ConvState> {
  const key = `${canal}:${externalId}`
  if (!await ready()) return memState.get(key) ?? DEFAULT_STATE
  const rows = await sql().query(
    `SELECT bot_state FROM conversations WHERE canal = $1 AND external_id = $2`,
    [canal, externalId],
  ) as Array<{ bot_state: Partial<ConvState> }>
  const st = rows[0]?.bot_state
  if (!st || typeof st !== 'object' || !('step' in st)) return DEFAULT_STATE
  return { ...DEFAULT_STATE, ...st }
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
  await sql().query(
    `INSERT INTO conversations (canal, external_id, bot_state) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (canal, external_id) DO UPDATE SET bot_state = EXCLUDED.bot_state`,
    [canal, externalId, JSON.stringify(next)],
  )
}

export interface RecordMessageInput {
  conversationId: number
  direccion: 'in' | 'out'
  texto: string
  autor: string // 'cliente' | 'bot' | 'agente'
  wamid?: string | null
}

/** Guarda un mensaje y actualiza la cabecera de la conversación (último mensaje, actividad, no leídos). */
export async function recordMessage(m: RecordMessageInput): Promise<MessageRow | null> {
  if (!await ready()) return null
  const texto = m.texto.trim()
  if (!texto) return null
  const q = sql()
  const rows = await q.query(
    `INSERT INTO messages (conversation_id, direccion, texto, autor, wamid)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wamid) WHERE wamid IS NOT NULL DO NOTHING
     RETURNING *`,
    [m.conversationId, m.direccion, texto, m.autor, m.wamid || null],
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

export async function setEstado(id: number, estado: Estado, opts: { markUnread?: boolean } = {}): Promise<void> {
  if (!await ready()) return
  await sql().query(
    `UPDATE conversations
     SET estado = $2,
         humano_at = CASE WHEN $2 = 'humano' THEN now() ELSE humano_at END,
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

export async function listConversations(search = '', limit = 100): Promise<ConversationRow[]> {
  if (!await ready()) return []
  const q = search.trim()
  if (q) {
    return (await sql().query(
      `SELECT * FROM conversations
       WHERE nombre ILIKE $1 OR external_id ILIKE $1
       ORDER BY ultima_actividad DESC LIMIT $2`,
      [`%${q}%`, limit],
    ) as any[]).map(normConv)
  }
  return (await sql().query(
    `SELECT * FROM conversations ORDER BY ultima_actividad DESC LIMIT $1`,
    [limit],
  ) as any[]).map(normConv)
}

export async function listMessages(conversationId: number, limit = 200): Promise<MessageRow[]> {
  if (!await ready()) return []
  const rows = await sql().query(
    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`,
    [conversationId, limit],
  ) as any[]
  return rows.reverse().map(normMsg)
}

/** Texto plano legible de un WaMessage (para guardar en la bandeja lo que dijo el bot). */
export function waMessageToText(m: WaMessage): string {
  if (m.type === 'text') return m.text.body
  const it = m.interactive as any
  const parts: string[] = []
  if (it?.header?.text) parts.push(String(it.header.text))
  if (it?.body?.text) parts.push(String(it.body.text))
  const opts = interactiveOptions(m)
  if (opts?.length) parts.push(opts.map((o, i) => `${i + 1}. ${o.title}`).join('\n'))
  if (it?.footer?.text) parts.push(String(it.footer.text))
  return parts.join('\n\n')
}

/** Texto legible de lo que escribió/tocó el cliente. */
export function incomingToText(input: { kind: string, text?: string, replyId?: string, replyTitle?: string }): string {
  if (input.kind === 'text') return input.text ?? ''
  if (input.kind === 'reply') return input.replyTitle || input.replyId || ''
  return '[mensaje no textual]'
}
