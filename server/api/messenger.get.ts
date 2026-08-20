/**
 * Verificación del webhook de Messenger/Instagram (Meta), mismo patrón que
 * whatsapp.get.ts: Meta hace un GET con ?hub.mode=subscribe&hub.verify_token=...&
 * hub.challenge=... y esperamos devolver el challenge tal cual SOLO si el
 * verify_token coincide con el nuestro (config.messengerVerifyToken).
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const mode = q['hub.mode']
  const token = q['hub.verify_token']
  const challenge = q['hub.challenge']
  const { messengerVerifyToken } = useRuntimeConfig()

  if (mode === 'subscribe' && token && messengerVerifyToken && token === messengerVerifyToken) {
    setHeader(event, 'content-type', 'text/plain')
    return String(challenge ?? '')
  }

  console.warn('[messenger] verificación de webhook rechazada (token no coincide o faltante)')
  throw createError({ statusCode: 403, message: 'Verification failed' })
})
