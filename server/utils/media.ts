import { randomBytes } from 'node:crypto'
import { dbConfigured, ensureSchema, sql } from './db'

/**
 * MEDIOS de la bandeja (imágenes, stickers, audios, videos, documentos): lo que
 * mandan los clientes por WhatsApp/Messenger/Instagram y las imágenes que el
 * agente envía desde /admin/chats.
 *
 * Almacenamiento: tabla `media` en la MISMA BD (Neon, BYTEA). Se eligió sobre
 * Vercel Blob para no depender de otra integración ni de otro token: los medios
 * de chat son pequeños (WhatsApp comprime fotos a ~100-300 KB y las notas de voz
 * pesan decenas de KB). Tope 4 MB por archivo (Vercel limita la respuesta de una
 * función a 4,5 MB); lo que pase de ahí NO se guarda y el mensaje queda con un
 * texto de aviso ("[Documento recibido: nombre.pdf]").
 *
 * Cada archivo se sirve en GET /api/media/<token> — token aleatorio de 128 bits,
 * inadivinable — porque Meta necesita una URL pública (link) para enviar imágenes
 * a Messenger y como respaldo en WhatsApp, y la bandeja la usa como src.
 */

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024

export interface MediaRow {
  id: number
  token: string
  mime: string
  bytes: number
  filename: string | null
  created_at: string
}
export interface MediaFile extends MediaRow { data: Buffer }

/** Tipos de mensaje con archivo (además de text/location/contacts/reaction/unsupported). */
export type MediaKind = 'image' | 'sticker' | 'audio' | 'video' | 'document'

const GRAPH_VERSION = 'v21.0'

async function ready(): Promise<boolean> {
  if (!dbConfigured()) return false
  try {
    await ensureSchema()
    return true
  }
  catch (err) {
    console.error('[media] BD no disponible:', String((err as Error)?.message ?? err))
    return false
  }
}

function normMedia(r: any): MediaRow {
  return { id: Number(r.id), token: String(r.token), mime: String(r.mime), bytes: Number(r.bytes), filename: r.filename ?? null, created_at: r.created_at }
}

/** Ruta relativa de un medio (la bandeja la usa como src: mismo origen, vale en local). */
export function mediaPath(token: string): string {
  return `/api/media/${token}`
}

/** URL pública ABSOLUTA de un medio guardado; la usa Meta para descargarlo (link). */
export function mediaUrl(token: string): string {
  const site = (useRuntimeConfig().public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
  return `${site}${mediaPath(token)}`
}

// ---------- retención y tope de almacenamiento ----------
// Neon free da 0,5 GB para TODA la BD (bandeja + estado del bot + inventario).
// Sin tope, los binarios la llenarían y tumbarían todo lo demás. Por eso:
//   - retención: el cron diario borra los medios de más de N días (el mensaje se
//     conserva con meta.expirado = true → "[archivo expirado]" en la bandeja);
//   - tope duro: al superar M MB en total no se guardan más binarios; el mensaje
//     se registra igual (con su aviso) y se loguea la alerta.
export function mediaRetentionDays(): number {
  const n = Number(useRuntimeConfig().mediaRetentionDays)
  return Number.isFinite(n) && n > 0 ? n : 60
}
export function mediaMaxTotalBytes(): number {
  const mb = Number(useRuntimeConfig().mediaMaxTotalMb)
  return (Number.isFinite(mb) && mb > 0 ? mb : 300) * 1024 * 1024
}

export interface MediaStats {
  bytes: number
  archivos: number
  mas_antiguo: string | null
  mas_reciente: string | null
  limite_bytes: number
  retencion_dias: number
  /** porcentaje usado del tope (0-100+) */
  pct: number
  lleno: boolean
}

export async function mediaStats(): Promise<MediaStats | null> {
  if (!await ready()) return null
  const rows = await sql().query(`SELECT COALESCE(SUM(bytes),0)::bigint AS b, count(*)::int AS c, min(created_at) AS o, max(created_at) AS n FROM media`) as any[]
  const r = rows[0] ?? {}
  const bytes = Number(r.b ?? 0)
  const limite = mediaMaxTotalBytes()
  return {
    bytes, archivos: Number(r.c ?? 0),
    mas_antiguo: r.o ? new Date(r.o).toISOString() : null,
    mas_reciente: r.n ? new Date(r.n).toISOString() : null,
    limite_bytes: limite, retencion_dias: mediaRetentionDays(),
    pct: Math.round((bytes / limite) * 1000) / 10,
    lleno: bytes >= limite,
  }
}

export type SaveFail = 'sin_bd' | 'demasiado_grande' | 'limite_almacenamiento'
export type SaveResult = { ok: true, row: MediaRow } | { ok: false, reason: SaveFail }

/** Guarda un archivo en la BD respetando tope por archivo y tope TOTAL. */
export async function saveMediaChecked(data: Buffer, mime: string, filename?: string | null): Promise<SaveResult> {
  if (!data?.length || data.length > MAX_MEDIA_BYTES) return { ok: false, reason: 'demasiado_grande' }
  if (!await ready()) return { ok: false, reason: 'sin_bd' }
  const stats = await mediaStats()
  if (stats && stats.bytes + data.length > stats.limite_bytes) {
    console.error(`[media] ⚠️ ALMACENAMIENTO DE MEDIOS LLENO: ${(stats.bytes / 1048576).toFixed(1)} MB de ${(stats.limite_bytes / 1048576).toFixed(0)} MB (${stats.archivos} archivos) — no se guarda ${filename ?? mime} (${data.length} bytes). Sube NUXT_MEDIA_MAX_TOTAL_MB, baja NUXT_MEDIA_RETENTION_DAYS o corre la retención.`)
    return { ok: false, reason: 'limite_almacenamiento' }
  }
  const token = randomBytes(16).toString('hex')
  const rows = await sql().query(
    `INSERT INTO media (token, mime, bytes, filename, data) VALUES ($1, $2, $3, $4, $5) RETURNING id, token, mime, bytes, filename, created_at`,
    [token, mime || 'application/octet-stream', data.length, filename || null, data],
  ) as any[]
  return rows[0] ? { ok: true, row: normMedia(rows[0]) } : { ok: false, reason: 'sin_bd' }
}

/**
 * RETENCIÓN: borra los medios de más de `mediaRetentionDays()` días. Antes marca
 * sus mensajes con meta.expirado = true (el registro del mensaje se conserva; la
 * bandeja muestra "[archivo expirado]"). Devuelve cuántos borró y cuántos bytes.
 */
export async function purgeExpiredMedia(): Promise<{ borrados: number, bytes: number, mensajes: number, dias: number }> {
  const dias = mediaRetentionDays()
  if (!await ready()) return { borrados: 0, bytes: 0, mensajes: 0, dias }
  const q = sql()
  const cutoff = new Date(Date.now() - dias * 86_400_000).toISOString()
  const marked = await q.query(
    `UPDATE messages SET meta = COALESCE(meta, '{}'::jsonb) || '{"expirado": true}'::jsonb
     WHERE media_id IN (SELECT id FROM media WHERE created_at < $1) RETURNING id`,
    [cutoff],
  ) as any[]
  const deleted = await q.query(`DELETE FROM media WHERE created_at < $1 RETURNING bytes`, [cutoff]) as any[]
  const bytes = deleted.reduce((s, r) => s + Number(r.bytes ?? 0), 0)
  if (deleted.length) console.info(`[media] retención: ${deleted.length} medios (> ${dias} días, ${(bytes / 1048576).toFixed(1)} MB) borrados; ${marked.length} mensajes marcados como expirados`)
  return { borrados: deleted.length, bytes, mensajes: marked.length, dias }
}

/** Guarda un archivo en la BD. null si no hay BD, excede el tope por archivo o el tope total. */
export async function saveMedia(data: Buffer, mime: string, filename?: string | null): Promise<MediaRow | null> {
  const r = await saveMediaChecked(data, mime, filename)
  return r.ok ? r.row : null
}

/** (Inserción directa sin comprobar el tope total: solo la usan las pruebas.) */
export async function saveMediaUnchecked(data: Buffer, mime: string, filename?: string | null): Promise<MediaRow | null> {
  if (!data?.length) return null
  if (!await ready()) return null
  const token = randomBytes(16).toString('hex')
  const rows = await sql().query(
    `INSERT INTO media (token, mime, bytes, filename, data) VALUES ($1, $2, $3, $4, $5) RETURNING id, token, mime, bytes, filename, created_at`,
    [token, mime || 'application/octet-stream', data.length, filename || null, data],
  ) as any[]
  return rows[0] ? normMedia(rows[0]) : null
}

export async function getMediaFile(token: string): Promise<MediaFile | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null
  if (!await ready()) return null
  const rows = await sql().query(`SELECT * FROM media WHERE token = $1`, [token]) as any[]
  if (!rows[0]) return null
  const d = rows[0].data
  const data = Buffer.isBuffer(d) ? d : Buffer.from(d)
  return { ...normMedia(rows[0]), data }
}

export interface Downloaded { data: Buffer, mime: string }
export type DownloadFail = 'sin_token' | 'demasiado_grande' | 'error'

/**
 * Descarga un medio de la WhatsApp Cloud API por su media_id (Media API de Meta):
 *   1) GET /<media_id>?phone_number_id=… → { url, mime_type, file_size }  (URL válida 5 min)
 *   2) GET <url> con Bearer token → binario
 * Devuelve el motivo si no se pudo (sin token en local, archivo > tope, error de red).
 */
export async function downloadWaMedia(mediaId: string): Promise<Downloaded | DownloadFail> {
  const { whatsappToken, whatsappPhoneId } = useRuntimeConfig()
  if (!whatsappToken) return 'sin_token'
  try {
    const info = await $fetch<{ url?: string, mime_type?: string, file_size?: number }>(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${whatsappToken}` }, query: whatsappPhoneId ? { phone_number_id: whatsappPhoneId } : {} },
    )
    if (!info?.url) return 'error'
    if (Number(info.file_size) > MAX_MEDIA_BYTES) return 'demasiado_grande'
    // Meta rechaza descargas sin User-Agent "de cliente" (403 en algunos runtimes).
    const res = await fetch(info.url, { headers: { 'Authorization': `Bearer ${whatsappToken}`, 'User-Agent': 'curl/8.4.0' } })
    if (!res.ok) {
      console.error(`[media] descarga de ${mediaId} falló: HTTP ${res.status}`)
      return 'error'
    }
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length > MAX_MEDIA_BYTES) return 'demasiado_grande'
    return { data, mime: info.mime_type || res.headers.get('content-type') || 'application/octet-stream' }
  }
  catch (err: any) {
    const detail = JSON.stringify(err?.data ?? err?.message ?? err).replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
    console.error(`[media] no se pudo descargar el medio ${mediaId} de WhatsApp:`, detail)
    return 'error'
  }
}

/** Descarga un adjunto por URL directa (CDN de Messenger/Instagram; también data: en pruebas). */
export async function downloadFromUrl(url: string): Promise<Downloaded | DownloadFail> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.4.0' } })
    if (!res.ok) {
      console.error(`[media] descarga de adjunto falló: HTTP ${res.status}`)
      return 'error'
    }
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_MEDIA_BYTES) return 'demasiado_grande'
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length > MAX_MEDIA_BYTES) return 'demasiado_grande'
    return { data, mime: ((res.headers.get('content-type') || 'application/octet-stream').split(';')[0] ?? 'application/octet-stream').trim() }
  }
  catch (err) {
    console.error('[media] no se pudo descargar el adjunto:', String((err as Error)?.message ?? err))
    return 'error'
  }
}

/** Extensión razonable para un MIME (nombres de descarga y subidas a Meta). */
export function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase()
  const table: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'video/mp4': 'mp4', 'video/3gpp': '3gp',
    'application/pdf': 'pdf', 'text/plain': 'txt',
  }
  if (table[m]) return table[m]
  const sub = m.split('/')[1] ?? ''
  return sub.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
}

/** Texto de aviso cuando un medio no pudo guardarse (queda como texto del mensaje). */
export function mediaPlaceholder(kind: MediaKind, filename?: string | null): string {
  switch (kind) {
    case 'image': return '[Imagen recibida]'
    case 'sticker': return '[Sticker recibido]'
    case 'audio': return '[Audio recibido]'
    case 'video': return '[Video recibido]'
    case 'document': return filename ? `[Documento recibido: ${filename}]` : '[Documento recibido]'
  }
}
