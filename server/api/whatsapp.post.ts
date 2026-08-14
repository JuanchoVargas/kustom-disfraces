/**
 * Recepción de mensajes entrantes de WhatsApp (Cloud API de Meta). Parsea el
 * mensaje, decide la respuesta con el árbol (buildBotReplies) y la envía por la
 * Cloud API. Responde SIEMPRE 200 rápido (Meta reintenta si no).
 *
 * Fase 1: el estado de conversación es en memoria (ver README). El bot es reactivo
 * (menús + botones) y lleva al cliente a la web.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)

  const incoming = parseIncoming(body)
  if (!incoming) return { received: true, ignored: true } // statuses u otros eventos

  const state = getConversation(incoming.from)
  const { replies, patch } = buildBotReplies(incoming, state)

  // Enviar cada respuesta del árbol (en orden). Si WhatsApp no está configurado,
  // sendWhatsAppMessage lo registra y no rompe (útil en local sin credenciales).
  for (const msg of replies) {
    await sendWhatsAppMessage(incoming.from, msg)
  }

  if (Object.keys(patch).length) setConversation(incoming.from, patch)

  // Log del handoff para atención humana (Fase 1: solo log/flag).
  if (patch.flaggedForHuman) {
    console.info(`[whatsapp] 🙋 conversación marcada para ATENCIÓN HUMANA: ${incoming.from}${incoming.profileName ? ` (${incoming.profileName})` : ''}`)
  }

  return { received: true, replied: replies.length }
})
