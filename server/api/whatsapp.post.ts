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

  // VISIBILIDAD: los eventos "statuses" (entregado/leído/FALLIDO) no traen mensaje
  // y antes se ignoraban en silencio. Un status "failed" es justamente donde muere
  // un interactivo aceptado por Graph (200+wamid) pero descartado en la entrega.
  logFailedStatuses(body)

  const incoming = parseIncoming(body)
  if (!incoming) return { received: true, ignored: true } // statuses u otros eventos

  const state = getConversation(incoming.from)
  // Capa de intención omnicanal (slots, saludos, typos, sin-resultados, tips) sobre
  // el cerebro base. El formato de salida (chunking de botones / fallback numerado)
  // no cambia: se aplica igual sobre los mensajes resultantes, más abajo.
  const { replies, patch } = buildReplies(incoming, state)

  // Enviar cada respuesta del árbol (en orden). Si WhatsApp no está configurado,
  // sendWhatsAppMessage lo registra y no rompe (útil en local sin credenciales).
  // FALLBACK: un interactivo que excede límites (validación) o cuyo envío falla se
  // degrada a texto plano con menú numerado; se recuerda el orden de ids para
  // mapear la respuesta numérica (1/2/…) de vuelta al id original.
  // Kill-switch: con el flag activo NO se intenta el interactivo (Meta lo acepta y
  // lo descarta); todos los menús salen directo como texto numerado.
  const forceText = useRuntimeConfig().whatsappForceTextMenu === true
  // En modo interactivo, los menús (listas de UNA sección) se parten en mensajes
  // de REPLY BUTTONS de 1 toque (chunks de ≤3). En force-text se dejan como están
  // para que el fallback numerado no cambie. Los resultados (lista multi-sección)
  // nunca se parten. toButtonChunks deja intacto lo que no es un menú-lista.
  const outgoing = forceText ? replies : replies.flatMap(toButtonChunks)
  let lastMenu: string[] | undefined
  for (const msg of outgoing) {
    const violations = forceText ? [] : validateInteractive(msg)
    if (violations.length) {
      console.error(`[whatsapp] payload interactivo inválido para ${incoming.from} — degradando a texto:`, violations.join('; '))
    }
    const skipInteractive = forceText && msg.type === 'interactive'
    const ok = (skipInteractive || violations.length) ? false : await sendWhatsAppMessage(incoming.from, msg)
    if (!ok && msg.type === 'interactive') {
      const fb = waNumberedFallback(msg)
      if (fb && await sendWhatsAppMessage(incoming.from, fb.message)) {
        lastMenu = fb.ids
      }
    }
  }

  // lastMenu refleja lo que REALMENTE se envió: se setea solo si hubo fallback a
  // texto; si el interactivo se entregó bien (o no hubo menú), se limpia para que
  // números viejos no queden mapeados a un menú obsoleto.
  setConversation(incoming.from, { ...patch, lastMenu })

  // Log del handoff para atención humana (Fase 1: solo log/flag).
  if (patch.flaggedForHuman) {
    console.info(`[whatsapp] 🙋 conversación marcada para ATENCIÓN HUMANA: ${incoming.from}${incoming.profileName ? ` (${incoming.profileName})` : ''}`)
  }

  return { received: true, replied: replies.length }
})
