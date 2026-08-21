/**
 * Receptor de eventos de Messenger e Instagram (Graph webhooks). Reutiliza el MISMO
 * cerebro del bot de WhatsApp (buildBotReplies) con un adaptador de canal:
 *  - body.object === "page" (Messenger/Marketplace) o "instagram" (DMs de IG)
 *  - por cada entry.messaging[]: sender.id (PSID/IGSID) + message.text o el payload
 *    de un quick_reply / postback (los ids de menú son idénticos a los de WhatsApp)
 *  - estado por clave "canal:senderId" (mismo ConvState en memoria)
 * SIEMPRE responde 200 rápido (Meta reintenta si no).
 */
import type { WaIncoming } from '../utils/whatsappBot'

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

      const key = `${channel}:${senderId}`
      const state = getConversation(key)
      // Cerebro de canal: slots + lenguaje natural, reusando buildBotReplies dentro.
      const { replies, patch } = buildMessengerReplies(incoming, state)

      // Adaptar la salida del bot a Messenger (quick replies, texto con URL, etc.).
      const { messages, lastMenu } = toMessengerReplies(replies)
      for (const msg of messages) {
        await sendMessengerMessage(String(senderId), msg)
      }
      setConversation(key, { ...patch, lastMenu })

      if (patch.flaggedForHuman) {
        console.info(`[messenger] 🙋 conversación marcada para ATENCIÓN HUMANA: ${key}`)
      }
    }
  }

  return { received: true }
})

/** Extrae texto o payload de un evento de messaging → WaIncoming para el cerebro. */
function parseMessengerEvent(senderId: string, ev: any): WaIncoming | null {
  // Quick reply: trae el payload (= id de menú) además del texto visible.
  const qrPayload = ev?.message?.quick_reply?.payload
  if (qrPayload) return { from: senderId, kind: 'reply', replyId: String(qrPayload) }
  // Postback (botones de plantilla / menú persistente / get started).
  const pbPayload = ev?.postback?.payload
  if (pbPayload) return { from: senderId, kind: 'reply', replyId: String(pbPayload) }
  // Texto libre.
  const text = ev?.message?.text
  if (typeof text === 'string' && text.trim()) return { from: senderId, kind: 'text', text }
  return null
}
