/**
 * Responder desde la bandeja. Usa el adaptador del canal (WhatsApp Cloud API o
 * Send API de Messenger/Instagram). Responder TOMA la conversación (estado=humano)
 * para que el bot no pise al agente. En WhatsApp se rechaza fuera de la ventana de
 * 24h (Meta solo acepta texto libre si el cliente escribió hace <24h).
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

  let ok = false
  if (conv.canal === 'wa') {
    if (!windowOpen(conv.ultimo_cliente_at)) throw createError({ statusCode: 409, statusMessage: 'window_closed' })
    if (!whatsappConfigured()) throw createError({ statusCode: 503, statusMessage: 'whatsapp_not_configured' })
    ok = await sendWhatsAppMessage(conv.external_id, waText(text, false))
  }
  else {
    if (!messengerConfigured()) throw createError({ statusCode: 503, statusMessage: 'messenger_not_configured' })
    ok = await sendMessengerMessage(conv.external_id, { text })
  }
  if (!ok) throw createError({ statusCode: 502, statusMessage: 'send_failed' })

  const msg = await recordMessage({ conversationId: id, direccion: 'out', texto: text, autor: 'agente' })
  if (conv.estado !== 'humano') {
    await setEstado(id, 'humano')
    await saveBotState(conv.canal, conv.external_id, { flaggedForHuman: false })
  }
  await markRead(id)
  return { ok: true, message: msg }
})
