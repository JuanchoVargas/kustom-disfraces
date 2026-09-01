/**
 * Receptor de eventos de Messenger e Instagram (Graph webhooks). Usa la MISMA capa
 * de intención omnicanal (buildReplies, en server/utils/botReplies.ts) que el
 * webhook de WhatsApp, con un adaptador de canal:
 *  - body.object === "page" (Messenger/Marketplace) o "instagram" (DMs de IG)
 *  - por cada entry.messaging[]: sender.id (PSID/IGSID) + message.text o el payload
 *    de un quick_reply / postback (los ids de menú son idénticos a los de WhatsApp)
 *  - conversación por (canal, senderId) en la bandeja; estado del bot persistido
 * SIEMPRE responde 200 rápido (Meta reintenta si no).
 */
import type { WaIncoming } from '../utils/whatsappBot'
import type { MessengerMessage } from '../utils/messenger'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const object = body?.object
  if (object !== 'page' && object !== 'instagram') {
    return { received: true, ignored: true } // otros objetos (p. ej. verificaciones cruzadas)
  }
  const channel = object === 'instagram' ? 'ig' : 'msg'

  // Meta puede mandar varias entries y varios eventos por entry. Se procesan en orden.
  const entries: any[] = Array.isArray(body?.entry) ? body.entry : []
  for (const entry of entries) {
    const events: any[] = Array.isArray(entry?.messaging) ? entry.messaging : []
    for (const ev of events) {
      // Ignora ecos (mensajes que la propia página envió) y eventos sin remitente.
      if (ev?.message?.is_echo) continue
      const senderId = ev?.sender?.id
      if (!senderId) continue

      const incoming = parseMessengerEvent(String(senderId), ev)
      if (!incoming) continue // read/delivery u otros eventos sin texto/payload

      const session = await openBotSession(channel, String(senderId), incoming)
      // Dedupe de reintentos (mismo mid ya respondido o en vuelo) y silencio por humano.
      if (session.skip) {
        console.info(`[${channel}] mid=${incoming.wamid ?? '—'} from=${senderId} replied=false skip=${session.skip}`)
        continue
      }
      if (session.silenced) continue

      // Capa de intención omnicanal: slots + lenguaje natural, reusando el cerebro base.
      const { replies, patch } = buildReplies(incoming, session.state)

      // Adaptar la salida del bot a Messenger (quick replies, texto con URL, etc.).
      const { messages, lastMenu } = toMessengerReplies(replies)
      const sentTexts: string[] = []
      let delivered = false
      for (const msg of messages) {
        const ok = await sendMessengerMessage(String(senderId), msg)
        if (ok) delivered = true
        if (ok || !messengerConfigured()) sentTexts.push(messengerToText(msg))
      }
      await closeBotSession({ session, canal: channel, externalId: String(senderId), incoming, sentTexts, delivered, patch: { ...patch, lastMenu } })
    }
  }

  return { received: true }
})

/** Extrae texto o payload de un evento de messaging → WaIncoming para el cerebro. */
function parseMessengerEvent(senderId: string, ev: any): WaIncoming | null {
  const wamid = ev?.message?.mid ? String(ev.message.mid) : undefined
  // Quick reply: trae el payload (= id de menú) además del texto visible.
  const qr = ev?.message?.quick_reply?.payload
  if (qr) return { from: senderId, kind: 'reply', replyId: String(qr), replyTitle: ev?.message?.text, wamid }
  // Postback (botones de plantilla / menú persistente / get started).
  const pb = ev?.postback?.payload
  if (pb) return { from: senderId, kind: 'reply', replyId: String(pb), replyTitle: ev?.postback?.title, wamid }
  // Texto libre.
  const text = ev?.message?.text
  if (typeof text === 'string' && text.trim()) return { from: senderId, kind: 'text', text, wamid }
  return null
}

/** Texto plano de un mensaje de Messenger (texto + quick replies numerados) para la bandeja. */
function messengerToText(m: MessengerMessage): string {
  const qrs = m.quick_replies?.length ? `\n\n${m.quick_replies.map((q, i) => `${i + 1}. ${q.title}`).join('\n')}` : ''
  return `${m.text}${qrs}`
}
