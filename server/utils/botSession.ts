import type { ConvState, WaIncoming } from './whatsappBot'
import type { WaMessage } from './whatsapp'
import type { Canal, ConversationRow } from './inbox'
import {
  ALERT_COOLDOWN_MIN, claimHandoffAlert, incomingToText, loadBotState, recordMessage, saveBotState, setEstado,
  upsertConversation, waMessageToText,
} from './inbox'
import { sendHandoffAlert } from './orderEmail'
import { sendTemplateMessage } from './whatsapp'

/**
 * Ciclo de vida de un mensaje entrante compartido por los tres canales (wa/msg/ig):
 *   1. registra la conversación y el mensaje del cliente en la bandeja
 *   2. carga el estado del bot (persistido) y decide si el bot debe callar
 *   3. tras responder, guarda lo que dijo el bot y aplica el handoff
 *
 * REGLA DE SILENCIO: con estado=humano el bot no contesta. Única excepción: el
 * cliente pidió "hablar con alguien" (flaggedForHuman) y NADIE lo ha atendido
 * todavía → una palabra de reinicio ("menú") le devuelve el bot (comportamiento
 * original). Cuando un agente toma la conversación o responde desde la bandeja,
 * flaggedForHuman se limpia y el bot queda apagado hasta "Devolver al bot".
 */

export interface BotSession {
  conv: ConversationRow | null
  state: ConvState
  /** true → el bot no debe generar respuestas (un humano lleva la conversación) */
  silenced: boolean
}

export async function openBotSession(canal: Canal, externalId: string, incoming: WaIncoming): Promise<BotSession> {
  const conv = await upsertConversation(canal, externalId, incoming.profileName)
  if (conv) {
    await recordMessage({
      conversationId: conv.id,
      direccion: 'in',
      texto: incomingToText(incoming),
      autor: 'cliente',
      wamid: incoming.wamid,
    })
    // Una conversación cerrada que recibe mensaje vuelve a manos del bot.
    if (conv.estado === 'cerrado') {
      await setEstado(conv.id, 'bot')
      conv.estado = 'bot'
    }
  }
  const state = await loadBotState(canal, externalId)
  const silenced = conv?.estado === 'humano' && !state.flaggedForHuman
  return { conv, state, silenced }
}

export interface CloseBotSessionInput {
  session: BotSession
  canal: Canal
  externalId: string
  incoming: WaIncoming
  /** mensajes que el bot REALMENTE envió (ya adaptados al canal), como texto */
  sentTexts: string[]
  patch: Partial<ConvState>
}

export async function closeBotSession(input: CloseBotSessionInput): Promise<void> {
  const { session, canal, externalId, incoming, sentTexts, patch } = input
  const conv = session.conv
  if (conv) {
    for (const texto of sentTexts) {
      await recordMessage({ conversationId: conv.id, direccion: 'out', texto, autor: 'bot' })
    }
  }
  await saveBotState(canal, externalId, patch)

  if (!conv) {
    if (patch.flaggedForHuman) console.info(`[${canal}] 🙋 conversación marcada para ATENCIÓN HUMANA: ${externalId}`)
    return
  }
  if (patch.flaggedForHuman) {
    // Handoff pedido por el cliente: pasa a humano, se marca no leída y se avisa a ventas.
    await setEstado(conv.id, 'humano', { markUnread: true })
    console.info(`[${canal}] 🙋 conversación #${conv.id} pasa a ATENCIÓN HUMANA: ${externalId}${incoming.profileName ? ` (${incoming.profileName})` : ''}`)
    // Anti-spam: máx. un aviso (correo + WhatsApp) cada 30 min por conversación.
    if (!await claimHandoffAlert(conv.id)) {
      console.info(`[${canal}] aviso de handoff #${conv.id} omitido (ya se avisó hace <${ALERT_COOLDOWN_MIN} min)`)
      return
    }
    const nombre = incoming.profileName || conv.nombre || undefined
    const ultimoMensaje = incomingToText(incoming)
    await sendHandoffAlert({ canal, externalId, nombre, ultimoMensaje, conversationId: conv.id })
    await notifyManagerWhatsApp(canal, externalId, nombre, ultimoMensaje)
  }
  else if (patch.flaggedForHuman === false && conv.estado === 'humano') {
    // El cliente reactivó el bot con "menú" antes de que alguien lo atendiera.
    await setEstado(conv.id, 'bot')
  }
}

/** Parámetro de plantilla válido: sin saltos de línea ni espacios dobles, máx. N caracteres. */
function templateParam(s: string | undefined, max: number): string {
  const clean = String(s ?? '').replace(/\s+/g, ' ').trim()
  const chars = [...clean]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : (clean || '—')
}

/**
 * Alerta por WhatsApp al celular del encargado (plantilla aprobada en Meta,
 * params: nombre, número/usuario, último mensaje). Best-effort: sin destino o
 * con fallo (plantilla aún no aprobada) solo se registra; el correo a ventas@
 * es el respaldo. NUNCA lanza (no puede romper el webhook).
 */
async function notifyManagerWhatsApp(canal: Canal, externalId: string, nombre: string | undefined, ultimoMensaje: string): Promise<void> {
  try {
    const c = useRuntimeConfig()
    const to = String(c.alertWhatsappTo || '').replace(/\D/g, '')
    if (!to) {
      console.error('[inbox-alert] NUXT_ALERT_WHATSAPP_TO sin configurar — no se envía alerta por WhatsApp (queda el correo)')
      return
    }
    const contacto = canal === 'wa' ? `+${externalId}` : `${canal === 'ig' ? 'Instagram' : 'Messenger'} ${externalId}`
    const params = [
      templateParam(nombre || 'Cliente sin nombre', 60),
      templateParam(contacto, 60),
      templateParam(ultimoMensaje, 200),
    ]
    const ok = await sendTemplateMessage(to, String(c.alertTemplateName || 'alerta_atencion'), params)
    if (ok) console.info(`[inbox-alert] alerta por WhatsApp enviada a ${to}`)
    else console.error(`[inbox-alert] alerta por WhatsApp NO enviada a ${to} (ver error de Graph arriba); el correo a ventas@ es el respaldo`)
  }
  catch (err) {
    console.error('[inbox-alert] error inesperado en la alerta por WhatsApp:', String((err as Error)?.message ?? err))
  }
}

/** Texto de los mensajes de WhatsApp enviados (para guardarlos en la bandeja). */
export function waTexts(messages: WaMessage[]): string[] {
  return messages.map(waMessageToText).filter(Boolean)
}
