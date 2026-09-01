import type { WaMessage } from './whatsapp'
import type { FoundProduct } from './productSearch'
import { waButtons, waList, waListSections, waText } from './whatsapp'
import { getPublico, getPublicos, publicoNombre, subNombre } from './catalogNav'
import { formatCOP, getProductBySlug, hasSize, searchProducts } from './productSearch'

/**
 * Árbol de decisión del bot de WhatsApp (Fase 1). `buildBotReplies` es una función
 * determinista (dado un mensaje entrante + estado → mensajes de salida), fácil de
 * testear con payloads de ejemplo sin tocar la red.
 *
 * La NAVEGACIÓN es casi sin estado: el id del botón/fila pulsado codifica el paso
 * (main:ver, pub:<slug>, sub:<pub>:<sub>, buy:<pub>:<sub>, human). El estado en
 * memoria solo recuerda el último paso y el flag de "atención humana".
 */

// ---------- estado de conversación (EN MEMORIA — ver limitación en README) ----------
export interface ConvState {
  step: string
  flaggedForHuman: boolean
  updatedAt: number
  // Orden de ids del último menú enviado como TEXTO numerado (fallback). Permite
  // mapear una respuesta "1"/"2"… de vuelta al id original. undefined si el último
  // menú se entregó como interactivo (el usuario responde tocando el botón/fila).
  lastMenu?: string[]
  // Talla pedida en la última búsqueda (p. ej. "4"). Se recuerda para que, al
  // elegir un producto de la lista, la ficha muestre ✅/⚠️ para ESA talla. Se
  // limpia al volver a MENÚ o en una nueva búsqueda sin talla.
  askedSize?: string
  // Pila de navegación: tokens de los menús ANCESTROS del actual (sin incluirlo).
  // Ej.: en subLink de Trusas/Damas → ['menu', 'publicos', 'sub:damas']. "0"/
  // "volver"/"atrás" hace pop de UN nivel; "menú" la vacía (reinicia). Tokens:
  // 'menu' (principal), 'publicos', 'sub:<pub>'. Ver screenFromToken().
  stack?: string[]
  // Slots de intención (OMNICANAL). La capa de intención (server/utils/botReplies.ts,
  // usada por ambos webhooks) recuerda aquí lo último que dijo el cliente para
  // combinar mensajes cortos ("Super man" → "talla 10"). Expiran a los 30 min
  // (updatedAt). Este cerebro base (buildBotReplies) los ignora por completo.
  slots?: { producto?: string, talla?: string, publico?: string, updatedAt?: number }
}
// El estado vive en Postgres (conversations.bot_state) — ver server/utils/inbox.ts
// (loadBotState / saveBotState). Sin BD configurada cae a un Map en memoria.

// ---------- parseo del webhook entrante ----------
export interface WaIncoming {
  from: string
  kind: 'text' | 'reply' | 'other'
  text?: string
  replyId?: string
  replyTitle?: string
  profileName?: string
  // id del mensaje en el canal (wamid en WhatsApp, mid en Messenger). Sirve para
  // deduplicar los reintentos de Meta al guardar en la bandeja.
  wamid?: string
}

function parseWaMessage(msg: any, value: any): WaIncoming | null {
  const contacts: any[] = Array.isArray(value?.contacts) ? value.contacts : []
  // IDENTIDAD DEL REMITENTE en cascada. Meta migró a Business-Scoped User IDs
  // (BSUID, p. ej. "CO.1041701705436358"): con username activo el teléfono puede
  // NO venir — llega from_user_id en el mensaje y user_id en contacts, SIN "from"
  // ni "wa_id". Antes eso descartaba el mensaje en silencio (bot mudo).
  const rawFrom = msg?.from ?? msg?.from_user_id ?? contacts[0]?.wa_id ?? contacts[0]?.user_id
  if (!rawFrom) {
    // Sin NINGÚN identificador no hay a quién responder — pero jamás en silencio.
    console.error('[whatsapp] ❌ mensaje SIN identidad de remitente (ni from, ni from_user_id, ni contacts) — msg:', JSON.stringify(msg))
    return null
  }
  const from = String(rawFrom)
  // El nombre de perfil del contacto que corresponde a ESTE remitente (Meta puede
  // traer varios contacts en un batch): casa por wa_id O por user_id (BSUID).
  const profileName = (contacts.find(c => String(c?.wa_id ?? '') === from || String(c?.user_id ?? '') === from) ?? contacts[0])?.profile?.name
  const wamid = msg.id ? String(msg.id) : undefined

  if (msg.type === 'text') return { from, kind: 'text', text: msg.text?.body ?? '', profileName, wamid }
  if (msg.type === 'interactive') {
    const it = msg.interactive
    if (it?.type === 'button_reply') return { from, kind: 'reply', replyId: it.button_reply?.id, replyTitle: it.button_reply?.title, profileName, wamid }
    if (it?.type === 'list_reply') return { from, kind: 'reply', replyId: it.list_reply?.id, replyTitle: it.list_reply?.title, profileName, wamid }
  }
  if (msg.type === 'button') return { from, kind: 'reply', replyId: msg.button?.payload ?? msg.button?.text, replyTitle: msg.button?.text, profileName, wamid }
  return { from, kind: 'other', profileName, wamid }
}

/**
 * TODOS los mensajes entrantes del webhook. Meta puede agrupar varios entries,
 * varios changes por entry y varios messages por change en un mismo POST; la
 * versión anterior solo miraba entry[0].changes[0].value.messages[0] y cualquier
 * mensaje en otra posición se descartaba EN SILENCIO (bot mudo sin rastro).
 */
export function parseIncomingAll(body: any): WaIncoming[] {
  const out: WaIncoming[] = []
  const entries: any[] = Array.isArray(body?.entry) ? body.entry : []
  for (const entry of entries) {
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      const value = change?.value
      const messages: any[] = Array.isArray(value?.messages) ? value.messages : []
      for (const msg of messages) {
        const inc = parseWaMessage(msg, value)
        if (inc) out.push(inc)
      }
    }
  }
  return out
}

/** Compatibilidad: primer mensaje del webhook (usada por scripts de prueba). */
export function parseIncoming(body: any): WaIncoming | null {
  return parseIncomingAll(body)[0] ?? null
}

/**
 * Radiografía ESTRUCTURAL del webhook para el log [wa-parse]: cuántos entries,
 * cuántos changes por entry con su `field`, y cuántos messages (con tipos y from)
 * y statuses encontró en cada value. Sirve para comparar contra [wa-raw] y ver en
 * qué paso el parser clasifica mal un payload real de Meta.
 */
export function parseDebugSummary(body: any): string {
  const entries: any[] = Array.isArray(body?.entry) ? body.entry : []
  if (!entries.length) return `entries=0 keys=${Object.keys(body ?? {}).join(',') || 'body vacío'}`
  const parts: string[] = [`entries=${entries.length}`]
  entries.forEach((entry, ei) => {
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : []
    if (!changes.length) parts.push(`e${ei}: changes=0 keys=${Object.keys(entry ?? {}).join(',')}`)
    changes.forEach((change, ci) => {
      const value = change?.value
      const messages: any[] = Array.isArray(value?.messages) ? value.messages : []
      const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : []
      const msgInfo = messages.length
        ? ` [${messages.map(m => `${m?.type ?? '?'}←${m?.from ?? m?.from_user_id ?? '?'}`).join(', ')}]`
        : ''
      parts.push(`e${ei}.c${ci} field=${change?.field ?? '—'} messages=${messages.length}${msgInfo} statuses=${statuses.length}${!messages.length && !statuses.length ? ` valueKeys=${Object.keys(value ?? {}).join(',') || 'ninguna'}` : ''}`)
    })
  })
  return parts.join(' | ')
}

/**
 * Resumen corto de un webhook SIN mensajes, para el log obligatorio: qué statuses
 * traía (sent/delivered/read/failed) o, si no trae nada reconocible, sus claves.
 * Así un evento con forma inesperada deja rastro en vez de ignorarse a ciegas.
 */
export function webhookSummary(body: any): string {
  const kinds: string[] = []
  const entries: any[] = Array.isArray(body?.entry) ? body.entry : []
  for (const entry of entries) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
      const value = change?.value
      const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : []
      for (const st of statuses) kinds.push(`status:${st?.status ?? '?'}→${st?.recipient_id ?? '?'}`)
      const errors: any[] = Array.isArray(value?.errors) ? value.errors : []
      for (const e of errors) kinds.push(`error:${e?.code ?? '?'}`)
      if (!statuses.length && !errors.length && !Array.isArray(value?.messages)) {
        kinds.push(`field:${change?.field ?? '?'} keys:${Object.keys(value ?? {}).join(',') || 'ninguna'}`)
      }
    }
  }
  if (!entries.length) kinds.push(`sin entry — keys:${Object.keys(body ?? {}).join(',') || 'body vacío'}`)
  return kinds.join(' | ')
}

/**
 * VISIBILIDAD (Fase de depuración): registra los webhooks de tipo "statuses" cuyo
 * status es "failed". Ahí aparece el motivo asíncrono por el que un mensaje
 * aceptado por Graph nunca llega al teléfono (code, title, error_data). Meta manda
 * estos eventos aparte del mensaje entrante, por eso antes se ignoraban.
 */
export function logFailedStatuses(body: any): void {
  const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses
  if (!Array.isArray(statuses)) return
  for (const st of statuses) {
    if (st?.status !== 'failed') continue
    console.error(
      `[whatsapp] ❌ status=failed wamid=${st?.id ?? '?'} to=${st?.recipient_id ?? '?'} — errors:`,
      JSON.stringify(st?.errors ?? [], null, 2),
    )
  }
}

// ---------- helpers de contenido ----------
const site = () => (useRuntimeConfig().public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
// "volver" ya NO reinicia: ahora hace pop de un nivel (ver BACK_WORDS). "menú"/
// "inicio"/"hola"… siguen reiniciando todo.
const RESET_WORDS = ['menu', 'menú', 'inicio', 'hola', 'buenas', 'empezar', 'start']
// Navegación: filas/botones id 'back' (atrás) y 'main:menu' (inicio). Van en todo
// menú salvo el principal. "0"/"volver"/"atrás" también disparan el back por texto.
const BACK_ROW = { id: 'back', title: '⬅️ Volver' }
const HOME_ROW = { id: 'main:menu', title: '🏠 Menú' }
const BACK_WORDS = new Set(['volver', 'atras', 'atrás', 'regresar'])

interface MenuOpt { id: string, title: string, description?: string }

/**
 * Construye un menú interactivo eligiendo el formato por ergonomía:
 *  - si (opciones + Volver + Menú) ≤ 3 → BOTONES de respuesta (1 toque, sin "Enviar").
 *  - si no → LISTA (máx 10 filas de la Cloud API; se reservan 2 para Volver + Menú).
 * `back` (por defecto true) agrega "⬅️ Volver" y "🏠 Menú"; se pone en false solo en
 * el menú principal. En BOTONES se pierden las descripciones (la Cloud API no las
 * admite), por eso los menús con textos "N disfraces" caen a lista con ≥2 opciones.
 */
function interactiveMenu(body: string, options: MenuOpt[], opts: { back?: boolean, listButton?: string, section?: string } = {}): WaMessage {
  const nav = opts.back !== false
  const extras = nav ? [BACK_ROW, HOME_ROW] : []
  const total = options.length + extras.length
  if (total <= 3) {
    return waButtons(body, [...options.map(o => ({ id: o.id, title: o.title })), ...extras])
  }
  const rows = nav ? [...options.slice(0, 8), ...extras] : options.slice(0, 10)
  return waList(body, opts.listButton ?? 'Ver opciones', rows, opts.section ?? 'Opciones')
}

function mainMenu(name?: string): WaMessage {
  const saludo = name ? `¡Hola, ${name}! 👋` : '¡Hola! 👋'
  // Menú principal: sin "Volver" (es la raíz). 4 opciones → lista (no caben en 3 botones).
  return interactiveMenu(
    `${saludo} Soy el asistente de *Kustom Disfraces* 👽\n¿Qué quieres hacer?`,
    [
      { id: 'main:ver', title: 'Ver disfraces' },
      { id: 'main:como', title: 'Cómo comprar' },
      { id: 'main:human', title: 'Hablar con alguien' },
      { id: 'main:catalogo', title: 'Ver catálogo 📖' },
    ],
    { back: false, listButton: 'Ver opciones', section: 'Menú' },
  )
}

/** Enlace al catálogo PDF completo (opción "Ver catálogo" del menú). */
function catalogoLink(): WaMessage {
  return waText(
    'Aquí tienes nuestro catálogo completo 👇\n'
    + `${site()}/catalogo-kustom.pdf\n`
    + 'Cuando veas uno que te guste, escríbeme el nombre y te paso precio y tallas 😉',
  )
}

function publicosList(): WaMessage {
  const options = getPublicos().map(p => ({
    id: `pub:${p.slug}`,
    title: p.nombre,
    description: p.count ? `${p.count} disfraces` : 'Muy pronto',
  }))
  return interactiveMenu('¿Para quién es el disfraz? 🎭', options, { listButton: 'Ver públicos', section: 'Públicos' })
}

function subcategoriasList(pubSlug: string): WaMessage {
  const pub = getPublico(pubSlug)
  if (!pub) return mainMenu()
  if (!pub.subcategorias.length) {
    const link = `${site()}/categoria/${pub.slug}`
    return interactiveMenu(
      `Estamos cargando más de *${pub.nombre}* 👀\nMíralo en la web 👇\n${link}`,
      [{ id: 'main:ver', title: 'Ver otros' }, { id: 'main:human', title: 'Hablar con alguien' }],
    )
  }
  const options = pub.subcategorias.map(s => ({
    id: `sub:${pub.slug}:${s.slug}`,
    title: s.nombre,
    description: `${s.count} disfraces`,
  }))
  return interactiveMenu(`Categorías de *${pub.nombre}* 🎃`, options, { listButton: 'Ver categorías', section: pub.nombre })
}

function subLink(pubSlug: string, subSlug: string): WaMessage {
  const link = `${site()}/categoria/${pubSlug}?sub=${subSlug}`
  const pn = publicoNombre(pubSlug) ?? pubSlug
  const sn = subNombre(pubSlug, subSlug) ?? subSlug
  return interactiveMenu(
    `¡Genial! Mira los disfraces de *${sn}* para *${pn}* 👇\n${link}`,
    [
      { id: `buy:${pubSlug}:${subSlug}`, title: '🛒 Comprar en la web' },
      { id: 'human', title: '💬 Pedir por WhatsApp' },
    ],
  )
}

function buyResend(pubSlug: string, subSlug: string): WaMessage {
  const link = `${site()}/categoria/${pubSlug}?sub=${subSlug}`
  return waText(`Aquí tienes el link para comprar en la web 🛒\n${link}\n\nEscribe *menú* para volver al inicio.`)
}

function comoComprar(): WaMessage {
  return interactiveMenu(
    '🛍️ *Cómo comprar en Kustom:*\n'
    + '1️⃣ Elige tu disfraz en la web\n'
    + '2️⃣ Págalo con Mercado Pago o pídelo por WhatsApp\n'
    + '3️⃣ Coordinamos el envío 🚚\n\n'
    + `Guía completa: ${site()}/como-comprar`,
    [{ id: 'main:ver', title: 'Ver disfraces' }, { id: 'main:human', title: 'Hablar con alguien' }],
  )
}

function handoff(): WaMessage {
  return waText(
    'Te paso con una persona del equipo 🙌\n'
    + 'En un momento te escribimos por aquí. Horario: Lunes a sábado, 8:00 a.m. a 7:00 p.m.\n\n'
    + '(Escribe *menú* si quieres volver a las opciones.)',
    false,
  )
}

// ---------- búsqueda de productos (texto libre) ----------

/** Ficha de un producto: nombre, precio, tallas, enlace y CTA de volver. */
function productoFicha(p: FoundProduct, requestedSize: string | null): WaMessage {
  const tallas = p.tallas.join(', ')
  const link = `${site()}/producto/${p.slug}`
  let sizeLine = ''
  if (requestedSize) {
    sizeLine = hasSize(p, requestedSize)
      ? `✅ Talla *${requestedSize}* disponible\n`
      : `⚠️ Talla *${requestedSize}* no disponible en este. Tallas: ${tallas}\n`
  }
  return waText(
    `🎭 *${p.nombre}*\n`
    + `💲 ${formatCOP(p.precio)}\n`
    + `📏 Tallas: ${tallas}\n`
    + sizeLine
    + `🔗 ${link}\n\n`
    + 'Escribe *MENÚ* para volver.',
  )
}

/**
 * Presentación por LÍNEA (grupo del catálogo) para agrupar los resultados. `order`
 * fija el orden de los grupos en la lista; varios grupos del catálogo se muestran
 * bajo una misma etiqueta (trusa-adulto/infantil → Trusas; peluche-* → Peluches).
 */
const LINEA_INFO: Record<string, { label: string, emoji: string, order: number }> = {
  'super': { label: 'Súper Acolchado', emoji: '🦸', order: 1 },
  'super-adulto': { label: 'Súper Acolchado', emoji: '🦸', order: 1 },
  'semi': { label: 'Semi Acolchado', emoji: '🦸', order: 2 },
  'economico': { label: 'Línea Eco', emoji: '🌱', order: 3 },
  'anime': { label: 'Anime', emoji: '🎌', order: 4 },
  'ninja': { label: 'Ninjas', emoji: '🥷', order: 5 },
  'trusa-adulto': { label: 'Trusas', emoji: '🩱', order: 6 },
  'trusa-infantil': { label: 'Trusas', emoji: '🩱', order: 6 },
  'vestidos': { label: 'Vestidos', emoji: '👗', order: 7 },
  'peluche-plus': { label: 'Peluches', emoji: '🧸', order: 8 },
  'peluche-linea': { label: 'Peluches', emoji: '🧸', order: 8 },
  'personajes': { label: 'Personajes', emoji: '🎭', order: 9 },
  'chaqueta': { label: 'Chaquetas', emoji: '🧥', order: 10 },
}
const LINEA_FALLBACK = { label: 'Otros', emoji: '🎭', order: 99 }

/**
 * 2-8 coincidencias: lista AGRUPADA por línea (con encabezado + emoji por grupo).
 * La numeración es CONTINUA entre grupos: la lista se entrega como interactivo de
 * varias secciones y, al degradar a texto (waNumberedFallback), cada sección se
 * rinde como encabezado y las filas se numeran de corrido → lastMenu sigue igual.
 */
function resultadosList(matches: FoundProduct[], requestedSize: string | null): WaMessage {
  const enc = requestedSize ? ` (talla ${requestedSize})` : ''
  // Agrupa por línea respetando el orden de relevancia dentro de cada grupo y el
  // orden de LINEA_INFO entre grupos. Map conserva el orden de primera aparición.
  const groups = new Map<string, { info: { label: string, emoji: string, order: number }, rows: Array<{ id: string, title: string, description: string }> }>()
  for (const p of matches) {
    const info = LINEA_INFO[p.grupo] ?? LINEA_FALLBACK
    let g = groups.get(info.label)
    if (!g) { g = { info, rows: [] }; groups.set(info.label, g) }
    g.rows.push({
      id: `prod:${p.slug}`,
      title: p.nombre,
      description: `${formatCOP(p.precio)} · tallas ${p.tallas.join(', ')}`,
    })
  }
  const sections = [...groups.values()]
    .sort((a, b) => a.info.order - b.info.order)
    .map(g => ({ title: `${g.info.emoji} ${g.info.label}`, rows: g.rows }))
  // Sección final de navegación: "⬅️ Volver" (id 'back', se rinde como "0. ⬅️
  // Volver") y "🏠 Menú".
  sections.push({ title: 'Navegación', rows: [BACK_ROW, HOME_ROW] })
  return waListSections(`Encontré ${matches.length} opciones${enc} 👇`, 'Ver opciones', sections)
}

/** 0 coincidencias: mensaje amable + menú. */
function sinResultados(query: string): WaMessage[] {
  return [
    waText(
      `No encontré nada para *"${query.trim()}"* 😅\n`
      + 'Puedo mostrarte el catálogo por categorías o pasarte con una persona.',
      false,
    ),
    mainMenu(),
  ]
}

// ---------- navegación atrás ----------
/**
 * Re-renderiza un menú a partir de su token de pila, devolviendo también el `step`
 * y la nueva pila (= ancestros de ESE menú). Tokens: 'menu' (principal, sin pila),
 * 'publicos', 'sub:<pub>'. subLink no es ancestro de nada, así que no aparece aquí.
 */
function screenFromToken(token: string): { message: WaMessage, step: string, stack: string[] } {
  if (token === 'publicos') return { message: publicosList(), step: 'publicos', stack: ['menu'] }
  if (token.startsWith('sub:')) return { message: subcategoriasList(token.slice(4)), step: token, stack: ['menu', 'publicos'] }
  return { message: mainMenu(), step: 'menu', stack: [] }
}

// ---------- árbol de decisión ----------
export interface BotResult { replies: WaMessage[], patch: Partial<ConvState> }

export function buildBotReplies(input: WaIncoming, state: ConvState): BotResult {
  let id = input.kind === 'reply' ? (input.replyId ?? '') : ''
  const text = (input.text ?? '').trim().toLowerCase()
  const isReset = RESET_WORDS.includes(text)

  // Fallback numérico: si el último menú se envió como texto (interactivo falló)
  // y el usuario responde solo con un número, se mapea a su id original.
  if (input.kind === 'text' && !isReset && /^\d+$/.test(text) && state.lastMenu?.length) {
    const mapped = state.lastMenu[Number(text) - 1]
    if (mapped) id = mapped
  }

  // Conversación marcada para atención humana: el bot NO interrumpe. Solo una
  // palabra de reinicio (p. ej. "menú") lo reactiva.
  if (state.flaggedForHuman) {
    if (!isReset) return { replies: [], patch: {} }
    return { replies: [mainMenu(input.profileName)], patch: { flaggedForHuman: false, step: 'menu', stack: [], askedSize: undefined } }
  }

  // Navegación ATRÁS: fila/botón 'back' (tap), palabras volver/atrás, o el número
  // "0". Hace pop de UN nivel usando la pila; sin pila cae al menú principal.
  const isBack = id === 'back' || (input.kind === 'text' && (text === '0' || BACK_WORDS.has(text)))
  if (isBack) {
    const stack = state.stack ?? []
    const parent = stack.length ? stack[stack.length - 1] : 'menu'
    const scr = screenFromToken(parent)
    return { replies: [scr.message], patch: { step: scr.step, stack: scr.stack, askedSize: undefined } }
  }

  if (id === 'main:ver') return { replies: [publicosList()], patch: { step: 'publicos', stack: ['menu'], askedSize: undefined } }
  if (id.startsWith('pub:')) return { replies: [subcategoriasList(id.slice(4))], patch: { step: `sub:${id.slice(4)}`, stack: ['menu', 'publicos'], askedSize: undefined } }
  if (id.startsWith('sub:')) {
    const [, pub, sub] = id.split(':')
    return { replies: [subLink(pub, sub)], patch: { step: `link:${pub}:${sub}`, stack: ['menu', 'publicos', `sub:${pub}`] } }
  }
  if (id.startsWith('buy:')) {
    const [, pub, sub] = id.split(':')
    return { replies: [buyResend(pub, sub)], patch: { step: `buy:${pub}:${sub}`, stack: [] } }
  }
  if (id === 'main:human' || id === 'human') {
    return { replies: [handoff()], patch: { flaggedForHuman: true, step: 'human', stack: [], askedSize: undefined } }
  }
  if (id === 'main:menu') return { replies: [mainMenu(input.profileName)], patch: { step: 'menu', stack: [], askedSize: undefined } }
  if (id === 'main:como') return { replies: [comoComprar()], patch: { step: 'como', stack: [], askedSize: undefined } }
  if (id === 'main:catalogo') return { replies: [catalogoLink()], patch: { step: 'catalogo', stack: [], askedSize: undefined } }
  if (id.startsWith('prod:')) {
    // Ficha desde la lista: usa la talla recordada de la búsqueda para el ✅/⚠️.
    const slug = id.slice(5)
    const p = getProductBySlug(slug)
    if (p) return { replies: [productoFicha(p, state.askedSize ?? null)], patch: { step: `prod:${slug}`, stack: [] } }
  }

  // Texto libre (no comando, no número de menú, no reinicio) -> búsqueda de productos.
  // Los clientes de Marketplace escriben "del hombre araña talla 4", "goku"…
  if (input.kind === 'text' && !isReset && !id && (input.text ?? '').trim()) {
    const res = searchProducts(input.text ?? '')
    if (res && res.matches.length) {
      // Recuerda la talla pedida (o límpiala si esta búsqueda no trae talla).
      const askedSize = res.requestedSize ?? undefined
      if (res.matches.length === 1) {
        return { replies: [productoFicha(res.matches[0], res.requestedSize)], patch: { step: 'ficha', stack: ['menu'], askedSize } }
      }
      return { replies: [resultadosList(res.matches, res.requestedSize)], patch: { step: 'resultados', stack: ['menu'], askedSize } }
    }
    if (res) return { replies: sinResultados(input.text ?? ''), patch: { step: 'sin-resultados', stack: [], askedSize: undefined } }
    // res === null: sin tokens útiles -> cae al menú de abajo.
  }

  // Cualquier mensaje inicial / texto libre / tipo no soportado -> saludo + menú.
  return { replies: [mainMenu(input.profileName)], patch: { step: 'menu', stack: [], askedSize: undefined } }
}
