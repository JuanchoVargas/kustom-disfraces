/**
 * Verificación del webhook de WhatsApp (Meta). Meta hace un GET con
 * ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... y espera que
 * devolvamos el challenge tal cual SOLO si el verify_token coincide con el nuestro.
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const mode = q['hub.mode']
  const token = q['hub.verify_token']
  const challenge = q['hub.challenge']
  const { whatsappVerifyToken } = useRuntimeConfig()

  if (mode === 'subscribe' && token && whatsappVerifyToken && token === whatsappVerifyToken) {
    // Debe responderse el challenge en texto plano.
    setHeader(event, 'content-type', 'text/plain')
    return String(challenge ?? '')
  }

  console.warn('[whatsapp] verificación de webhook rechazada (token no coincide o faltante)')
  throw createError({ statusCode: 403, message: 'Verification failed' })
})
