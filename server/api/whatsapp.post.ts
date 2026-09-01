/**
 * Recepción de mensajes entrantes de WhatsApp (Cloud API de Meta). Parsea TODOS
 * los mensajes del webhook (Meta puede agrupar varios en un POST), decide la
 * respuesta con el árbol (buildBotReplies) y la envía por la Cloud API. Responde
 * SIEMPRE 200 rápido (Meta reintenta si no).
 *
 * Persistencia: cada mensaje entrante y saliente queda en la bandeja (Postgres,
 * server/utils/inbox.ts) y el estado del bot vive en conversations.bot_state.
 * Con estado=humano el bot calla (ver botSession.ts).
 *
 * LOG OBLIGATORIO: cada webhook deja una línea [whatsapp] con wamid, from, estado
 * de la conversación, si fue duplicado y si se respondió (o el motivo del skip).
 * Un webhook sin mensajes también se registra (resumen de statuses / estructura).
 */
import type { WaIncoming } from '../utils/whatsappBot'
import type { WaMessage } from '../utils/whatsapp'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)

  // VISIBILIDAD: los eventos "statuses" (entregado/leído/FALLIDO) no traen mensaje.
  // Un status "failed" es justamente donde muere un interactivo aceptado por Graph
  // (200+wamid) pero descartado en la entrega.
  logFailedStatuses(body)

  const incomings = parseIncomingAll(body)
  if (!incomings.length) {
    // Sin mensajes: statuses u otros eventos. Se registra QUÉ era para no volver a
    // quedar a ciegas ante un webhook con forma inesperada.
    console.info(`[whatsapp] webhook sin mensajes — ${webhookSummary(body)}`)
    return { received: true, ignored: true }
  }

  let replied = 0
  for (const incoming of incomings) replied += await handleIncoming(incoming)
  return { received: true, replied }
})

/** Procesa UN mensaje entrante. Devuelve cuántas respuestas generó el árbol. */
async function handleIncoming(incoming: WaIncoming): Promise<number> {
  const session = await openBotSession('wa', incoming.from, incoming)
  const conv = session.conv
  const log = (extra: string) => console.info(
    `[whatsapp] wamid=${incoming.wamid ?? '—'} from=${incoming.from} kind=${incoming.kind}`
    + ` conv=${conv ? `#${conv.id}` : 'SIN-BD'} estado=${conv?.estado ?? '—'}`
    + ` flagged=${session.state.flaggedForHuman ? 'sí' : 'no'} dup=${session.duplicate ? 'sí' : 'no'}`
    + `${session.autoReturned ? ' autoReturn=sí' : ''} ${extra}`,
  )

  // DEDUPE: reintento de Meta de un wamid YA respondido (o aún en vuelo) → no se
  // vuelve a responder. Un reintento de un wamid al que no se le respondió sigue
  // de largo y puede responder (ver openBotSession).
  if (session.skip) {
    log(`replied=false skip=${session.skip}`)
    return 0
  }
  if (session.silenced) {
    log('replied=false skip=humano_atendiendo')
    return 0
  }

  // Capa de intención omnicanal (slots, saludos, typos, sin-resultados, tips) sobre
  // el cerebro base. El formato de salida (chunking de botones / fallback numerado)
  // no cambia: se aplica igual sobre los mensajes resultantes, más abajo.
  const { replies, patch } = buildReplies(incoming, session.state)

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
  const sent: WaMessage[] = []
  for (const msg of outgoing) {
    const violations = forceText ? [] : validateInteractive(msg)
    if (violations.length) {
      console.error(`[whatsapp] payload interactivo inválido para ${incoming.from} — degradando a texto:`, violations.join('; '))
    }
    const skipInteractive = forceText && msg.type === 'interactive'
    const ok = (skipInteractive || violations.length) ? false : await sendWhatsAppMessage(incoming.from, msg)
    if (ok) {
      sent.push(msg)
      continue
    }
    if (msg.type === 'interactive') {
      const fb = waNumberedFallback(msg)
      if (fb && await sendWhatsAppMessage(incoming.from, fb.message)) {
        lastMenu = fb.ids
        sent.push(fb.message)
      }
    }
  }

  // lastMenu refleja lo que REALMENTE se envió: se setea solo si hubo fallback a
  // texto; si el interactivo se entregó bien (o no hubo menú), se limpia para que
  // números viejos no queden mapeados a un menú obsoleto.
  // Sin credenciales (local) nada se envía: igual se guarda lo PLANEADO para poder
  // ver la conversación en la bandeja.
  const configured = whatsappConfigured()
  const delivered = configured && sent.length > 0
  const sentTexts = waTexts(configured ? sent : outgoing)
  await closeBotSession({ session, canal: 'wa', externalId: incoming.from, incoming, sentTexts, delivered, patch: { ...patch, lastMenu } })

  if (!replies.length) log('replied=false skip=arbol_sin_respuesta (handoff pendiente)')
  else if (delivered) log(`replied=true enviados=${sent.length}/${outgoing.length}`)
  else log(`replied=false skip=${configured ? 'envio_fallido (ver errores de Graph arriba)' : 'whatsapp_sin_configurar'} planeados=${outgoing.length}`)
  return replies.length
}
