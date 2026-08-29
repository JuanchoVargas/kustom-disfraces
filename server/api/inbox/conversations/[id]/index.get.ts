/** Detalle: conversación + mensajes (orden cronológico) + ventana de 24h. */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'bad_id' })
  const conv = await getConversationById(id)
  if (!conv) throw createError({ statusCode: 404, statusMessage: 'not_found' })
  const messages = await listMessages(id)
  const { bot_state: _omit, ...pub } = conv
  return {
    conversation: { ...pub, window_open: conv.canal === 'wa' ? windowOpen(conv.ultimo_cliente_at) : true },
    messages,
    now: new Date().toISOString(),
  }
})
