/**
 * BOTÓN DE EMERGENCIA: devuelve TODAS las conversaciones en estado=humano al bot
 * de inmediato (y limpia flaggedForHuman en su bot_state) — para cuando un handoff
 * se quedó pegado y el bot está mudo con varios clientes a la vez.
 *
 *   POST /api/inbox/conversations/reset-humano   (requiere sesión de la bandeja)
 *
 * El auto-retorno de 30 min (ver inbox.autoReturnToBot) hace esto mismo solo y por
 * conversación; este endpoint es el "ya mismo, todas".
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const ids = await resetAllHumanToBot()
  if (ids.length) console.info(`[inbox] 🔄 ${ids.length} conversación(es) devueltas al BOT a mano: #${ids.join(', #')}`)
  return { ok: true, devueltas: ids.length, ids }
})
