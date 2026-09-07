
/**
 * MEDIOS DE WORDPRESS (wp/v2/media) para las imágenes de producto del panel de
 * inventario. La API de WooCommerce no sube archivos: se usa la REST API de
 * WordPress con una CONTRASEÑA DE APLICACIÓN (NUXT_WP_APP_USER +
 * NUXT_WP_APP_PASSWORD), en Basic Auth sobre HTTPS. Solo servidor.
 *
 * Procesamiento antes de subir (sharp): lado mayor ≤ 1600 px, WebP calidad 85,
 * nombre de archivo = SKU (+ sufijo) para que la biblioteca de medios quede
 * ordenada. Los archivos > 10 MB se rechazan antes de procesar.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_SIDE = 1600
export const WEBP_QUALITY = 85
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'])

export function wpMediaConfigured(): boolean {
  const c = useRuntimeConfig()
  return !!(c.wooBaseUrl && c.wpAppUser && c.wpAppPassword)
}

function authHeader(): string {
  const c = useRuntimeConfig()
  // WordPress muestra la contraseña de aplicación con espacios; los acepta con o sin ellos.
  const pass = String(c.wpAppPassword).replace(/\s+/g, '')
  return `Basic ${Buffer.from(`${c.wpAppUser}:${pass}`).toString('base64')}`
}

export const sanitizeWpError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***')

export interface WpMedia {
  id: number
  source_url: string
  title?: { rendered?: string }
  alt_text?: string
  mime_type?: string
  media_details?: { width?: number, height?: number, filesize?: number }
}

async function wp<T>(path: string, opts: { method?: string, body?: BodyInit, headers?: Record<string, string> } = {}): Promise<T> {
  const c = useRuntimeConfig()
  if (!wpMediaConfigured()) throw new Error('WordPress sin credenciales de medios (NUXT_WP_APP_USER / NUXT_WP_APP_PASSWORD)')
  const res = await fetch(`${c.wooBaseUrl}/wp-json/wp/v2${path}`, {
    method: opts.method ?? 'GET',
    headers: { Authorization: authHeader(), ...(opts.headers ?? {}) },
    body: opts.body,
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) }
  catch { json = text }
  if (!res.ok) throw new Error(`wp/v2${path} → HTTP ${res.status}: ${typeof json === 'string' ? json.slice(0, 200) : (json?.message ?? JSON.stringify(json).slice(0, 200))}`)
  return json as T
}

/** ¿Las credenciales sirven? Devuelve el usuario o el motivo. */
export async function wpMediaPing(): Promise<{ ok: boolean, detail: string }> {
  if (!wpMediaConfigured()) return { ok: false, detail: 'faltan NUXT_WP_APP_USER / NUXT_WP_APP_PASSWORD' }
  try {
    const me = await wp<{ name?: string, slug?: string, capabilities?: Record<string, boolean> }>('/users/me?context=edit')
    const puede = !!(me.capabilities?.upload_files)
    return { ok: puede, detail: puede ? `WordPress: ${me.name ?? me.slug} puede subir medios` : `WordPress: ${me.name ?? me.slug} NO tiene permiso upload_files` }
  }
  catch (err) {
    return { ok: false, detail: `WordPress no responde: ${sanitizeWpError(err)}` }
  }
}

export interface Processed { data: Buffer, width: number, height: number, bytes: number, mime: 'image/webp' }

/** sharp se carga solo cuando hay que procesar una imagen (no en el arranque de cada función). */
const loadSharp = async () => (await import('sharp')).default

/** Redimensiona (lado mayor ≤ 1600, sin agrandar) y convierte a WebP 85. Lanza si no es imagen. */
export async function processImage(input: Buffer, mime: string): Promise<Processed> {
  const sharp = await loadSharp()
  if (input.length > MAX_UPLOAD_BYTES) throw new Error(`archivo de ${(input.length / 1048576).toFixed(1)} MB: el máximo es 10 MB`)
  if (mime && !ACCEPTED.has(mime.toLowerCase().split(';')[0]!.trim())) throw new Error(`tipo no admitido (${mime}): usa JPG, PNG, WebP, GIF o HEIC`)
  let img = sharp(input, { failOn: 'error', animated: false }).rotate() // respeta la orientación EXIF
  const meta = await img.metadata()
  if (!meta.width || !meta.height) throw new Error('no se pudo leer la imagen')
  img = img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).webp({ quality: WEBP_QUALITY, effort: 4 })
  const data = await img.toBuffer()
  const out = await sharp(data).metadata()
  return { data, width: out.width ?? 0, height: out.height ?? 0, bytes: data.length, mime: 'image/webp' }
}

/** Nombre de archivo ordenado por SKU: 001001001.webp, 001001001-2.webp, … */
export function mediaFilename(sku: string, index: number): string {
  const base = sku.replace(/[^A-Za-z0-9_-]/g, '')
  return index <= 1 ? `${base}.webp` : `${base}-${index}.webp`
}

/** Sube un binario a la biblioteca de medios. Devuelve el medio creado. */
export async function uploadMedia(data: Buffer, filename: string, opts: { title?: string, alt?: string } = {}): Promise<WpMedia> {
  const media = await wp<WpMedia>('/media', {
    method: 'POST',
    headers: { 'Content-Type': 'image/webp', 'Content-Disposition': `attachment; filename="${filename}"` },
    body: new Uint8Array(data),
  })
  if (opts.title || opts.alt) {
    await wp<WpMedia>(`/media/${media.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(opts.title ? { title: opts.title } : {}), ...(opts.alt ? { alt_text: opts.alt } : {}) }),
    }).catch(() => {})
  }
  return media
}

export async function getMedia(id: number): Promise<WpMedia | null> {
  try { return await wp<WpMedia>(`/media/${id}`) }
  catch { return null }
}
