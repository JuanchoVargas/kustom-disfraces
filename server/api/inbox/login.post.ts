/** Login de la bandeja: contraseña única → cookie de sesión firmada (7 días). */
export default defineEventHandler(async (event) => {
  if (!inboxConfigured()) throw createError({ statusCode: 503, statusMessage: 'inbox_not_configured' })
  const body = await readBody(event).catch(() => ({}))
  const password = String(body?.password ?? '')
  if (!passwordMatches(password)) {
    // Freno suave a fuerza bruta (una sola contraseña, sin usuarios).
    await new Promise(r => setTimeout(r, 800))
    throw createError({ statusCode: 401, statusMessage: 'bad_password' })
  }
  issueSession(event)
  return { ok: true }
})
