import { extForMime, MAX_MEDIA_BYTES, mediaUrl, saveMedia } from '../../../../utils/media'
import { uploadWhatsAppMedia, waImage } from '../../../../utils/whatsapp'
import { sendMessengerAttachment } from '../../../../utils/messenger'

/**
 * Enviar una IMAGEN desde la bandeja (multipart: `file` jpg/png/webp + `caption`
 * opcional). Flujo:
 *   1. se guarda en la tabla media (queda en el historial y se sirve en /api/media/<token>)
 *   2. WhatsApp: se sube a la Media API de Meta y se envía por `image.id` (si la
 *      subida falla, se envía por `image.link` con nuestra URL pública);
 *      Messenger/Instagram: `attachment: { type: 'image', payload: { url } }`
 *   3. se registra como mensaje saliente tipo image y la conversación pasa al agente.
 * Fuera de la ventana de 24 h de WhatsApp responde 409 `window_closed`.
 * Tope: 4 MB (la bandeja comprime antes de subir; Vercel corta el body en 4,5 MB).
 */
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'bad_id' })

  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  const caption = String(parts?.find(p => p.name === 'caption')?.data?.toString('utf8') ?? '').trim().slice(0, 1024)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'no_file' })
  const mime = (String(file.type || '').split(';')[0] ?? '').trim().toLowerCase()
  if (!ALLOWED.has(mime)) throw createError({ statusCode: 415, statusMessage: 'bad_type' })
  if (file.data.length > MAX_MEDIA_BYTES) throw createError({ statusCode: 413, statusMessage: 'too_large' })

  const conv = await getConversationById(id)
  if (!conv) throw createError({ statusCode: 404, statusMessage: 'not_found' })
  if (conv.canal === 'wa' && !windowOpen(conv.ultimo_cliente_at)) throw createError({ statusCode: 409, statusMessage: 'window_closed' })

  const filename = (file.filename && /\.[a-z0-9]{2,5}$/i.test(file.filename)) ? file.filename : `imagen.${extForMime(mime)}`
  const saved = await saveMedia(Buffer.from(file.data), mime, filename)
  if (!saved) throw createError({ statusCode: 503, statusMessage: 'db_not_configured' })
  const url = mediaUrl(saved.token)

  const dryRun = deliverOrDryRun(conv.canal, async () => {
    if (conv.canal === 'wa') {
      const mediaId = await uploadWhatsAppMedia(Buffer.from(file.data), mime, filename)
      const msg = mediaId ? waImage({ id: mediaId }, caption) : waImage({ link: url }, caption)
      if (!mediaId) console.warn(`[inbox] subida a la Media API falló — se envía la imagen por link (${url})`)
      return sendWhatsAppMessage(conv.external_id, msg)
    }
    // Messenger/IG no llevan caption en el adjunto: se manda como texto aparte.
    const ok = await sendMessengerAttachment(conv.external_id, 'image', url)
    if (ok && caption) await sendMessengerMessage(conv.external_id, { text: caption })
    return ok
  })
  const ok = await dryRun.send()
  if (!ok) throw createError({ statusCode: 502, statusMessage: 'send_failed' })

  const msg = await recordMessage({
    conversationId: id,
    direccion: 'out',
    texto: caption || '[Imagen]',
    autor: 'agente',
    tipo: 'image',
    mediaId: saved.id,
    meta: { caption: caption || undefined, filename, mime, bytes: saved.bytes, ...(dryRun.dry ? { dry_run: true } : {}) },
  })
  if (conv.estado !== 'humano') {
    await setEstado(id, 'humano')
    await saveBotState(conv.canal, conv.external_id, { flaggedForHuman: false })
  }
  await markRead(id)
  return { ok: true, message: msg, dry_run: dryRun.dry }
})
