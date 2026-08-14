/**
 * Cliente de la WhatsApp Cloud API (Meta) — envío de mensajes y constructores de
 * mensajes interactivos. Solo servidor; el token vive en runtimeConfig.
 *
 * Límites de la Cloud API que respetamos aquí:
 *  - botones de respuesta: máx 3, título ≤ 20
 *  - listas: máx 10 filas en total, título de fila ≤ 24, descripción ≤ 72
 *  - texto del cuerpo (body): ≤ 1024
 */

const GRAPH_VERSION = 'v21.0'

export interface WaButton { id: string, title: string }
export interface WaRow { id: string, title: string, description?: string }

/** Mensaje listo para la Cloud API (sin messaging_product/to, que se añaden al enviar). */
export type WaMessage =
  | { type: 'text', text: { body: string, preview_url?: boolean } }
  | { type: 'interactive', interactive: Record<string, unknown> }

const cut = (s: string, max: number) => {
  const t = String(s ?? '')
  return [...t].length > max ? [...t].slice(0, max).join('') : t
}

export function waText(body: string, previewUrl = true): WaMessage {
  return { type: 'text', text: { body: cut(body, 4096), preview_url: previewUrl } }
}

export function waButtons(body: string, buttons: WaButton[]): WaMessage {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: cut(body, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map(b => ({
          type: 'reply',
          reply: { id: cut(b.id, 256), title: cut(b.title, 20) },
        })),
      },
    },
  }
}

export function waList(body: string, buttonLabel: string, rows: WaRow[], sectionTitle = 'Opciones'): WaMessage {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: cut(body, 1024) },
      action: {
        button: cut(buttonLabel, 20),
        sections: [{
          title: cut(sectionTitle, 24),
          rows: rows.slice(0, 10).map(r => ({
            id: cut(r.id, 200),
            title: cut(r.title, 24),
            ...(r.description ? { description: cut(r.description, 72) } : {}),
          })),
        }],
      },
    },
  }
}

export function whatsappConfigured(): boolean {
  const c = useRuntimeConfig()
  return !!(c.whatsappToken && c.whatsappPhoneId)
}

/** Envía un mensaje por la Cloud API. NO lanza: registra el fallo y devuelve false. */
export async function sendWhatsAppMessage(to: string, message: WaMessage): Promise<boolean> {
  const { whatsappToken, whatsappPhoneId } = useRuntimeConfig()
  if (!whatsappToken || !whatsappPhoneId) {
    console.warn('[whatsapp] sin token/phone_id — no se envía (mensaje planeado):', JSON.stringify(message))
    return false
  }
  try {
    await $fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${whatsappPhoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${whatsappToken}` },
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message },
    })
    return true
  }
  catch (err) {
    // Se redacta el Bearer por si apareciera en el error.
    const msg = String((err as Error)?.message ?? err).replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
    console.error(`[whatsapp] fallo al enviar a ${to}:`, msg)
    return false
  }
}
