import { getMediaFile } from '../../utils/media'

/**
 * Sirve un medio guardado (imagen/audio/documento de un chat) por su token
 * aleatorio de 128 bits. Es PÚBLICO a propósito (sin sesión de la bandeja): Meta
 * descarga esta URL para enviar imágenes a Messenger (y como respaldo en
 * WhatsApp), y el token inadivinable hace las veces de secreto — el mismo modelo
 * de las URLs de Vercel Blob o del CDN de WhatsApp. Cache larga: el contenido de
 * un token nunca cambia.
 */
export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') ?? '').toLowerCase()
  const m = await getMediaFile(token)
  if (!m) throw createError({ statusCode: 404, statusMessage: 'not_found' })
  const safeName = (m.filename || `archivo-${token.slice(0, 8)}`).replace(/[\r\n"]/g, '').slice(0, 120)
  const inline = /^(image|audio|video)\//.test(m.mime) || m.mime === 'application/pdf'
  setHeader(event, 'Content-Type', m.mime)
  setHeader(event, 'Content-Length', m.bytes)
  setHeader(event, 'Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  return m.data
})
