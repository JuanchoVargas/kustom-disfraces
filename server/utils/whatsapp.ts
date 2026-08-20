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

// ---------- validación de límites y fallback a texto ----------

/** Límites duros de la Cloud API para mensajes interactivos (referencia). */
const LIMITS = {
  buttons: 3, buttonTitle: 20, buttonId: 256,
  rows: 10, rowTitle: 24, rowDesc: 72, rowId: 200,
  listButton: 20, sectionTitle: 24, body: 1024,
} as const

const len = (s: unknown) => [...String(s ?? '')].length

/**
 * Valida un mensaje YA construido contra los límites duros de la Cloud API.
 * `cut()` ya trunca los largos al construir, así que esto captura sobre todo lo
 * que `cut()` NO cubre: opciones vacías, IDs duplicados, exceso de filas/botones
 * y body vacío. Devuelve la lista de violaciones (vacía = ok). Solo revisa
 * interactivos; para `text` siempre devuelve [].
 */
export function validateInteractive(message: WaMessage): string[] {
  if (message.type !== 'interactive') return []
  const v: string[] = []
  const it = message.interactive as any
  const bodyText = it?.body?.text
  if (!bodyText || !String(bodyText).trim()) v.push('body.text vacío (obligatorio)')
  else if (len(bodyText) > LIMITS.body) v.push(`body.text ${len(bodyText)}>${LIMITS.body}`)

  if (it?.type === 'button') {
    const buttons: any[] = it?.action?.buttons ?? []
    if (!buttons.length) v.push('sin botones (mín 1)')
    if (buttons.length > LIMITS.buttons) v.push(`${buttons.length} botones >${LIMITS.buttons}`)
    const ids = new Set<string>()
    buttons.forEach((b, i) => {
      const r = b?.reply ?? {}
      if (!r.title || !String(r.title).trim()) v.push(`botón ${i} sin título`)
      else if (len(r.title) > LIMITS.buttonTitle) v.push(`botón ${i} título ${len(r.title)}>${LIMITS.buttonTitle}`)
      if (!r.id) v.push(`botón ${i} sin id`)
      else if (len(r.id) > LIMITS.buttonId) v.push(`botón ${i} id ${len(r.id)}>${LIMITS.buttonId}`)
      if (r.id && ids.has(r.id)) v.push(`botón ${i} id duplicado: ${r.id}`)
      ids.add(r.id)
    })
  }
  else if (it?.type === 'list') {
    const label = it?.action?.button
    if (!label || !String(label).trim()) v.push('action.button (label de lista) vacío')
    else if (len(label) > LIMITS.listButton) v.push(`label de lista ${len(label)}>${LIMITS.listButton}`)
    const sections: any[] = it?.action?.sections ?? []
    const allRows = sections.flatMap(s => s?.rows ?? [])
    if (!allRows.length) v.push('lista sin filas (mín 1)')
    if (allRows.length > LIMITS.rows) v.push(`${allRows.length} filas >${LIMITS.rows}`)
    const ids = new Set<string>()
    sections.forEach((s) => {
      if (s?.title && len(s.title) > LIMITS.sectionTitle) v.push(`section title ${len(s.title)}>${LIMITS.sectionTitle}`)
      ;(s?.rows ?? []).forEach((r: any, i: number) => {
        if (!r?.title || !String(r.title).trim()) v.push(`fila ${i} sin título`)
        else if (len(r.title) > LIMITS.rowTitle) v.push(`fila "${r.title}" ${len(r.title)}>${LIMITS.rowTitle}`)
        if (r?.description && len(r.description) > LIMITS.rowDesc) v.push(`fila "${r.title}" desc ${len(r.description)}>${LIMITS.rowDesc}`)
        if (!r?.id) v.push(`fila ${i} sin id`)
        else if (len(r.id) > LIMITS.rowId) v.push(`fila ${i} id ${len(r.id)}>${LIMITS.rowId}`)
        if (r?.id && ids.has(r.id)) v.push(`fila id duplicado: ${r.id}`)
        ids.add(r?.id)
      })
    })
  }
  else {
    v.push(`interactive.type no soportado: ${it?.type}`)
  }
  return v
}

/** Opciones ordenadas [{id,title,description?}] de un interactivo, o null. */
export function interactiveOptions(message: WaMessage): Array<{ id: string, title: string, description?: string }> | null {
  if (message.type !== 'interactive') return null
  const it = message.interactive as any
  if (it?.type === 'button') {
    return (it?.action?.buttons ?? []).map((b: any) => ({ id: b?.reply?.id, title: b?.reply?.title }))
  }
  if (it?.type === 'list') {
    return (it?.action?.sections ?? []).flatMap((s: any) => s?.rows ?? [])
      .map((r: any) => ({ id: r?.id, title: r?.title, description: r?.description }))
  }
  return null
}

/**
 * Degrada un mensaje interactivo a texto plano con menú numerado (1. …, 2. …).
 * Devuelve el WaMessage de texto y el orden de ids (para mapear la respuesta
 * numérica del usuario de vuelta al id original). null si no es interactivo.
 */
export function waNumberedFallback(message: WaMessage): { message: WaMessage, ids: string[] } | null {
  const opts = interactiveOptions(message)
  if (!opts || !opts.length) return null
  const it = (message as any).interactive
  const body = String(it?.body?.text ?? '').trim()
  // La descripción (p. ej. precio · tallas) desambigua títulos que la lista
  // interactiva recorta a 24 chars — el canal de texto no tiene ese límite.
  const lines = opts.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)
  const text = `${body}\n\n${lines.join('\n')}\n\nResponde con el número de la opción.`
  return { message: waText(text, false), ids: opts.map(o => o.id) }
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
