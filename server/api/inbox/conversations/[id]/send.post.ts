/**
 * Responder desde la bandeja (texto). Usa el adaptador del canal (WhatsApp Cloud
 * API o Send API de Messenger/Instagram). Responder TOMA la conversación
 * (estado=humano) para que el bot no pise al agente. En WhatsApp se rechaza fuera
 * de la ventana de 24h (Meta solo acepta texto libre si el cliente escribió hace
 * <24h). Una conversación archivada vuelve a activa al responder.
 *
 * SOLO EN `nuxt dev` sin credenciales del canal: el mensaje se guarda como
 * "no enviado (local)" (meta.dry_run) para poder probar la bandeja sin Meta. En
 * producción sin credenciales sigue respondiendo 503.
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'bad_id' })
  const body = await readBody(event).catch(() => ({}))
  const text = String(body?.text ?? '').trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: 'empty_text' })
  if (text.length > 4000) throw createError({ statusCode: 400, statusMessage: 'too_long' })

  const conv = await getConversationById(id)
  if (!conv) throw createError({ statusCode: 404, statusMessage: 'not_found' })

  const dryRun = deliverOrDryRun(conv.canal, () => {
    if (conv.canal === 'wa') {
      if (!windowOpen(conv.ultimo_cliente_at)) throw createError({ statusCode: 409, statusMessage: 'window_closed' })
      return sendWhatsAppMessage(conv.external_id, waText(text, false))
    }
    return sendMessengerMessage(conv.external_id, { text })
  })
  const ok = await dryRun.send()
  if (!ok) throw createError({ statusCode: 502, statusMessage: 'send_failed' })

  const msg = await recordMessage({ conversationId: id, direccion: 'out', texto: text, autor: 'agente', meta: dryRun.dry ? { dry_run: true } : null })
  if (conv.estado !== 'humano') {
    await setEstado(id, 'humano')
    await saveBotState(conv.canal, conv.external_id, { flaggedForHuman: false })
  }
  await markRead(id)
  return { ok: true, message: msg, dry_run: dryRun.dry }
})
