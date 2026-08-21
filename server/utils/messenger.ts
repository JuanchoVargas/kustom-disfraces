import type { WaMessage } from './whatsapp'
import { interactiveOptions, waNumberedFallback } from './whatsapp'

/**
 * Adaptador de SALIDA para Messenger e Instagram (Graph Send API). El cerebro del
 * bot (buildBotReplies) sigue produciendo mensajes con forma de WhatsApp (WaMessage:
 * text | interactive button/list). Aquí los MAPEAMOS al formato de Messenger:
 *
 *  - menús/botones (interactive) → QUICK REPLIES. Messenger admite hasta 13, así que
 *    TODOS nuestros menús caben en un solo mensaje: ni chunking ni listas.
 *  - resultados de búsqueda (lista multi-sección) → el texto numerado/agrupado (con
 *    precios y tallas, que un quick reply no puede mostrar) + quick replies para elegir.
 *  - enlaces (categoría/catálogo/tallas) y fichas → texto con la URL (Messenger la
 *    autoenlaza). No hace falta button template.
 *
 * El bot de WhatsApp queda INTACTO; esto solo traduce su salida.
 */

const GRAPH_VERSION = 'v21.0'

// Límites de Messenger que respetamos: quick reply title ≤ 20, hasta 13 quick
// replies, texto ≤ 2000. cut() por code points (emojis cuentan 1).
const QR_MAX = 13
const cut = (s: string, max: number) => {
  const t = String(s ?? '')
  return [...t].length > max ? [...t].slice(0, max).join('') : t
}

export interface MessengerQuickReply { content_type: 'text', title: string, payload: string }
export interface MessengerMessage { text: string, quick_replies?: MessengerQuickReply[] }

// Quick reply "🏠 Menú" que va en TODO mensaje del bot en este canal (además de
// "⬅️ Volver" donde aplique — hay cupo: el límite de Messenger es 13).
const HOME_QR: MessengerQuickReply = { content_type: 'text', title: '🏠 Menú', payload: 'main:menu' }

// Este canal NO usa numeración ni "escribe MENÚ": se quita el copy "Responde con el
// número…", la línea "0. ⬅️ Volver" y "Escribe *MENÚ*…" (Volver y Menú son quick
// replies). Los números escritos igual se aceptan en silencio (el receptor guarda lastMenu).
function cleanChannelText(text: string): string {
  return text
    .replace(/\n*0\.\s*⬅️\s*Volver/gu, '')
    .replace(/\n*Responde con el número de la opción\.?/gu, '')
    .replace(/\n*Escribe \*?menú\*? para volver(?: al inicio)?\.?/giu, '')
    .trimEnd()
}

/**
 * Mapea UN mensaje del bot a un mensaje de Messenger. Añade el quick reply "🏠 Menú"
 * (y el guía "Toca una opción 👇" cuando hay opciones). Devuelve también los ids de
 * opción del menú (para recordar el "lastMenu" y aceptar respuestas numéricas).
 */
export function toMessengerMessages(m: WaMessage): { messages: MessengerMessage[], optionIds: string[] } {
  if (m.type !== 'interactive') {
    // Texto (ficha, catálogo, enlaces): solo el "🏠 Menú".
    return { messages: [{ text: cut(cleanChannelText(m.text.body), 2000), quick_replies: [HOME_QR] }], optionIds: [] }
  }
  const opts = interactiveOptions(m) ?? []
  const quick_replies = opts.slice(0, QR_MAX - 1).map(o => ({
    content_type: 'text' as const,
    title: cut(o.title, 20),
    payload: o.id,
  }))
  quick_replies.push(HOME_QR) // 🏠 Menú siempre presente (≤13 en total)

  // Resultados (lista de varias secciones): el texto numerado conserva precio·tallas
  // que el quick reply no muestra. Los menús normales van con su cuerpo tal cual.
  const it = m.interactive as any
  const multiSection = it?.type === 'list' && (it?.action?.sections?.length ?? 0) > 1
  const raw = multiSection
    ? (waNumberedFallback(m)?.message.text.body ?? String(it?.body?.text ?? ''))
    : String(it?.body?.text ?? '')
  const text = `${cleanChannelText(raw)}\n\nToca una opción 👇`
  return { messages: [{ text: cut(text, 2000), quick_replies }], optionIds: opts.map(o => o.id) }
}

/**
 * Mapea TODA la tanda de respuestas del bot. `lastMenu` = ids de opción del último
 * menú enviado (o undefined si el último mensaje no era menú), para mapear luego
 * respuestas numéricas "1"/"2"… al id original (mismo mecanismo que WhatsApp).
 */
export function toMessengerReplies(replies: WaMessage[]): { messages: MessengerMessage[], lastMenu?: string[] } {
  const messages: MessengerMessage[] = []
  let lastMenu: string[] | undefined
  for (const r of replies) {
    const { messages: ms, optionIds } = toMessengerMessages(r)
    messages.push(...ms)
    lastMenu = optionIds.length ? optionIds : undefined
  }
  return { messages, lastMenu }
}

export function messengerConfigured(): boolean {
  return !!useRuntimeConfig().messengerPageToken
}

/**
 * Envía un mensaje por la Send API (Messenger e Instagram usan el mismo endpoint
 * /me/messages de la Página). NO lanza: registra el fallo y devuelve false para que
 * el sitio no se caiga. En error, loguea el body COMPLETO del error de Graph.
 */
export async function sendMessengerMessage(recipientId: string, message: MessengerMessage): Promise<boolean> {
  const { messengerPageToken } = useRuntimeConfig()
  if (!messengerPageToken) {
    console.warn('[messenger] sin page token — no se envía (mensaje planeado):', JSON.stringify(message))
    return false
  }
  try {
    await $fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
      method: 'POST',
      query: { access_token: messengerPageToken },
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message },
    })
    return true
  }
  catch (err: any) {
    // El detalle real de Graph viene en err.data (fetch de ofetch). Se loguea completo.
    const detail = err?.data ?? err?.response?._data ?? err?.message ?? err
    console.error(`[messenger] fallo al enviar a ${recipientId}:`, JSON.stringify(detail))
    return false
  }
}
