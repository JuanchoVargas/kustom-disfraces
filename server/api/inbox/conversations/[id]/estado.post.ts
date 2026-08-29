/**
 * "Tomar conversación" (estado=humano, pausa el bot) / "Devolver al bot" (estado=bot)
 * / "Cerrar" (estado=cerrado). Al tomarla o devolverla se limpia el flag de handoff
 * del bot para que el cliente no pueda reactivarlo con "menú" mientras un humano
 * atiende (ver botSession.ts).
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'bad_id' })
  const body = await readBody(event).catch(() => ({}))
  const estado = String(body?.estado ?? '')
  if (estado !== 'bot' && estado !== 'humano' && estado !== 'cerrado') {
    throw createError({ statusCode: 400, statusMessage: 'bad_estado' })
  }
  const conv = await getConversationById(id)
  if (!conv) throw createError({ statusCode: 404, statusMessage: 'not_found' })

  await setEstado(id, estado)
  await saveBotState(conv.canal, conv.external_id, {
    flaggedForHuman: false,
    // Al devolver al bot, arranca limpio desde el menú (sin pila ni slots viejos).
    ...(estado === 'bot' ? { step: 'start', stack: [], lastMenu: undefined, askedSize: undefined, slots: undefined } : {}),
  })
  return { ok: true, estado }
})
