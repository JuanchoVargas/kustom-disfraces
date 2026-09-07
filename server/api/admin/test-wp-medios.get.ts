import { deflateSync } from 'node:zlib'
import { wooWriteFetch, wooWriteCredentials } from '../../utils/wooWrite'

/**
 * TEMPORAL — verificación de la SUBIDA DE MEDIOS a WordPress desde Vercel (las
 * credenciales NUXT_WP_APP_USER / NUXT_WP_APP_PASSWORD solo viven allí). Autocontenido:
 * no depende de la rama de imágenes. Se BORRA después de la prueba.
 *
 * GET /api/admin/test-wp-medios[?sku=001003001]  — requiere sesión del panel.
 *   1. autentica con la contraseña de aplicación (users/me) y revisa upload_files
 *   2. elige un producto EN BORRADOR (o el ?sku= si es borrador)
 *   3. genera una imagen pequeña al vuelo: WebP con sharp (igual que el panel) y,
 *      si sharp fallara, un PNG hecho a mano (para que el resto de la prueba siga)
 *   4. la sube a la biblioteca (wp/v2/media)
 *   5. la lee de vuelta por su URL pública (HTTP 200, mismo tamaño) y sus metadatos
 *   6. la asigna al borrador como última imagen y relee el producto
 *   7. quita la asignación (deja las imágenes que tenía) y verifica
 *   8. borra el archivo (force=true) y verifica que ya no existe
 * Devuelve JSON con cada paso, ok y el motivo exacto. Siempre intenta limpiar.
 */
interface Step { paso: string, ok: boolean, detalle?: unknown }

const env = () => ({
  base: process.env.NUXT_WOO_BASE_URL || process.env.WOO_API_URL || '',
  user: process.env.NUXT_WP_APP_USER || '',
  pass: (process.env.NUXT_WP_APP_PASSWORD || '').replace(/\s+/g, ''),
})
const authHeader = () => {
  const e = env()
  return `Basic ${Buffer.from(`${e.user}:${e.pass}`).toString('base64')}`
}
const redact = (err: unknown) => String((err as Error)?.message ?? err)
  .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***')
  .replace(/consumer_(key|secret)=[^&\s]+/g, 'consumer_$1=***')

async function wp<T>(path: string, opts: { method?: string, body?: BodyInit, headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`${env().base}/wp-json/wp/v2${path}`, {
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

/** PNG RGB 64×64 hecho a mano (sin dependencias): cuadros morados y blancos. */
function pngFallback(): Buffer {
  const w = 64, h = 64, stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3
      const morado = ((x >> 3) + (y >> 3)) % 2 === 0
      raw[o] = morado ? 0x7E : 0xFF
      raw[o + 1] = morado ? 0x57 : 0xFF
      raw[o + 2] = morado ? 0xC2 : 0xFF
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xFFFFFFFF
    for (const x of b) c = table[(c ^ x) & 0xFF]! ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const steps: Step[] = []
  const t0 = Date.now()
  const wantSku = String(getQuery(event).sku ?? '').trim()
  const done = (ok: boolean, conclusion: string) => ({ ok, conclusion, ms: Date.now() - t0, steps })
  let mediaId: number | null = null
  let productId: number | null = null
  let originalImages: { id: number }[] = []
  let restored = false

  try {
    // 1. credenciales
    const e = env()
    if (!e.base || !e.user || !e.pass) {
      const faltan = [!e.base && 'NUXT_WOO_BASE_URL', !e.user && 'NUXT_WP_APP_USER', !e.pass && 'NUXT_WP_APP_PASSWORD'].filter(Boolean).join(', ')
      steps.push({ paso: '1. variables de entorno', ok: false, detalle: `faltan: ${faltan}` })
      return done(false, `Faltan variables: ${faltan}`)
    }
    try {
      const me = await wp<{ name?: string, slug?: string, capabilities?: Record<string, boolean> }>('/users/me?context=edit')
      const puede = !!me.capabilities?.upload_files
      steps.push({ paso: '1. autenticación con contraseña de aplicación (users/me)', ok: puede, detalle: puede ? `${me.name ?? me.slug} puede subir medios (upload_files)` : `${me.name ?? me.slug} NO tiene permiso upload_files` })
      if (!puede) return done(false, 'El usuario autentica pero no puede subir medios')
    }
    catch (err) {
      steps.push({ paso: '1. autenticación con contraseña de aplicación (users/me)', ok: false, detalle: redact(err) })
      return done(false, 'WordPress no acepta las credenciales (usuario, contraseña de aplicación o REST bloqueada)')
    }
    if (!wooWriteCredentials()) {
      steps.push({ paso: '1b. llave de escritura de Woo', ok: false, detalle: 'falta NUXT_WOO_WRITE_* / NUXT_WOO_ORDERS_*' })
      return done(false, 'Sin llave de escritura de Woo no se puede asignar la imagen al producto')
    }

    // 2. producto en borrador
    let drafts: any[]
    try {
      drafts = wantSku
        ? await wooWriteFetch<any[]>('/products', { query: { sku: wantSku } })
        : await wooWriteFetch<any[]>('/products', { query: { status: 'draft', type: 'variable', per_page: 10 } })
    }
    catch (err) {
      steps.push({ paso: '2. buscar producto en borrador (wc/v3)', ok: false, detalle: redact(err) })
      return done(false, 'La llave de Woo no pudo leer productos')
    }
    const product = drafts.find(p => p.sku && p.status === 'draft')
    if (!product) {
      steps.push({ paso: '2. producto de prueba (borrador)', ok: false, detalle: wantSku ? `${wantSku} no existe o no está en borrador` : 'no hay borradores' })
      return done(false, 'Sin producto en borrador para la prueba')
    }
    productId = product.id
    originalImages = (product.images ?? []).map((i: any) => ({ id: i.id }))
    steps.push({ paso: '2. producto de prueba (borrador)', ok: true, detalle: { sku: product.sku, nombre: product.name, id: product.id, imagenes_actuales: originalImages.map(i => i.id) } })

    // 3. imagen generada al vuelo
    let data: Buffer
    let mime = 'image/webp'
    let ext = 'webp'
    try {
      const sharpMod = await import('sharp')
      const sharp = sharpMod.default
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#7E57C2"/><text x="160" y="150" font-family="Arial" font-size="34" fill="#fff" text-anchor="middle">Kustom</text><text x="160" y="200" font-family="Arial" font-size="22" fill="#fff" text-anchor="middle">prueba ${product.sku}</text></svg>`
      data = await sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer()
      steps.push({ paso: '3. imagen generada con sharp (WebP 320×320, como hará el panel)', ok: data.length > 200, detalle: { bytes: data.length, sharp: (sharp as any).versions?.sharp, libvips: (sharp as any).versions?.vips } })
    }
    catch (err) {
      data = pngFallback()
      mime = 'image/png'
      ext = 'png'
      steps.push({ paso: '3. imagen generada con sharp', ok: false, detalle: `sharp falló en esta función: ${redact(err)} — se sigue con un PNG hecho a mano (${data.length} bytes)` })
    }

    // 4. subir
    const filename = `prueba-medios-${product.sku}-${Date.now()}.${ext}`
    let media: any
    try {
      media = await wp<any>('/media', { method: 'POST', headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}"` }, body: new Uint8Array(data) })
      mediaId = media.id
      await wp(`/media/${media.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `PRUEBA medios ${product.sku} (se borra sola)`, alt_text: 'prueba' }) }).catch(() => {})
      steps.push({ paso: '4. subida a la biblioteca (POST wp/v2/media)', ok: !!media.id && !!media.source_url, detalle: { id: media.id, url: media.source_url, mime: media.mime_type } })
    }
    catch (err) {
      steps.push({ paso: '4. subida a la biblioteca (POST wp/v2/media)', ok: false, detalle: redact(err) })
      return done(false, 'WordPress rechazó la subida')
    }

    // 5. leer de vuelta por URL pública + metadatos
    try {
      const back = await fetch(media.source_url, { headers: { 'User-Agent': 'curl/8.4.0' }, signal: AbortSignal.timeout(30_000) })
      const buf = Buffer.from(await back.arrayBuffer())
      steps.push({ paso: '5. lectura por URL pública', ok: back.ok && buf.length === data.length, detalle: { status: back.status, content_type: back.headers.get('content-type'), bytes: buf.length, esperado: data.length } })
    }
    catch (err) { steps.push({ paso: '5. lectura por URL pública', ok: false, detalle: redact(err) }) }
    try {
      const meta = await wp<any>(`/media/${media.id}`)
      steps.push({ paso: '5b. metadatos (media_details)', ok: !!meta?.media_details?.width, detalle: { width: meta?.media_details?.width, height: meta?.media_details?.height, mime: meta?.mime_type } })
    }
    catch (err) { steps.push({ paso: '5b. metadatos (media_details)', ok: false, detalle: redact(err) }) }

    // 6. asignar al borrador
    try {
      const assigned: any = await wooWriteFetch(`/products/${product.id}`, { method: 'PUT', body: { images: [...originalImages, { id: media.id }] } })
      steps.push({ paso: '6. asignada al borrador como última imagen (PUT wc/v3/products)', ok: (assigned.images ?? []).some((i: any) => i.id === media.id), detalle: { imagenes_ahora: (assigned.images ?? []).map((i: any) => i.id) } })
      const reread: any = await wooWriteFetch(`/products/${product.id}`)
      steps.push({ paso: '6b. relectura del producto confirma la asignación', ok: (reread.images ?? []).some((i: any) => i.id === media.id) })
    }
    catch (err) { steps.push({ paso: '6. asignada al borrador', ok: false, detalle: redact(err) }) }

    // 7. quitar la asignación
    try {
      const unassigned: any = await wooWriteFetch(`/products/${product.id}`, { method: 'PUT', body: { images: originalImages } })
      const ids: number[] = (unassigned.images ?? []).map((i: any) => i.id)
      restored = !ids.includes(media.id) && ids.length === originalImages.length
      steps.push({ paso: '7. asignación retirada (el producto vuelve a sus imágenes originales)', ok: restored, detalle: { imagenes_ahora: ids } })
    }
    catch (err) { steps.push({ paso: '7. asignación retirada', ok: false, detalle: redact(err) }) }

    // 8. borrar el archivo
    try {
      const del = await wp<any>(`/media/${media.id}?force=true`, { method: 'DELETE' })
      steps.push({ paso: '8. archivo borrado de la biblioteca (DELETE force=true)', ok: del?.deleted === true, detalle: { deleted: del?.deleted } })
      if (del?.deleted === true) mediaId = null
      const after = await fetch(`${env().base}/wp-json/wp/v2/media/${media.id}`, { headers: { Authorization: authHeader() } })
      steps.push({ paso: '8b. ya no existe', ok: after.status === 404, detalle: `HTTP ${after.status}` })
    }
    catch (err) { steps.push({ paso: '8. archivo borrado de la biblioteca', ok: false, detalle: redact(err) }) }
  }
  catch (err) {
    steps.push({ paso: 'error inesperado', ok: false, detalle: redact(err) })
  }
  finally {
    // Limpieza si algo quedó a medias
    if (productId && mediaId && !restored) {
      try {
        await wooWriteFetch(`/products/${productId}`, { method: 'PUT', body: { images: originalImages } })
        steps.push({ paso: 'limpieza: imágenes del borrador restauradas', ok: true })
      }
      catch (err) { steps.push({ paso: 'limpieza: restaurar imágenes del borrador', ok: false, detalle: redact(err) }) }
    }
    if (mediaId) {
      try {
        await wp(`/media/${mediaId}?force=true`, { method: 'DELETE' })
        steps.push({ paso: 'limpieza: archivo borrado', ok: true })
      }
      catch (err) { steps.push({ paso: 'limpieza: borrar archivo', ok: false, detalle: `${redact(err)} — borrar a mano el medio ${mediaId} en WordPress` }) }
    }
  }
  const ok = steps.every(s => s.ok)
  return done(ok, ok ? 'WordPress acepta subidas y Woo asigna imágenes: el panel de imágenes y la migración pueden usarse' : 'Falló algún paso: ver steps')
})
