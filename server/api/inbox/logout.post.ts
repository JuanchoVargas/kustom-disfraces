export default defineEventHandler((event) => {
  clearInboxSession(event)
  return { ok: true }
})
