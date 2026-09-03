import type { Canal } from './inbox'
import { messengerConfigured } from './messenger'
import { whatsappConfigured } from './whatsapp'

/**
 * Envío desde la BANDEJA con modo "en seco" SOLO para desarrollo local: en
 * `nuxt dev` sin credenciales del canal (token de WhatsApp / page token), el
 * mensaje no se envía pero se guarda marcado (meta.dry_run) para poder probar la
 * bandeja de punta a punta sin Meta. En producción (`import.meta.dev` = false)
 * sin credenciales se responde 503 como siempre.
 */
export function deliverOrDryRun(canal: Canal, send: () => Promise<boolean>): { dry: boolean, send: () => Promise<boolean> } {
  const configured = canal === 'wa' ? whatsappConfigured() : messengerConfigured()
  if (configured) return { dry: false, send }
  if (import.meta.dev) {
    console.warn(`[inbox] ${canal} sin credenciales — envío EN SECO (solo local): el mensaje se guarda pero no se envía`)
    return { dry: true, send: async () => true }
  }
  throw createError({ statusCode: 503, statusMessage: canal === 'wa' ? 'whatsapp_not_configured' : 'messenger_not_configured' })
}
