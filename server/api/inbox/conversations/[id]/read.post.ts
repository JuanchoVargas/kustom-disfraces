/** Marca la conversación como leída (no_leidos = 0). */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'bad_id' })
  await markRead(id)
  return { ok: true }
})
