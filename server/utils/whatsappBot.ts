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
}
const store = new Map<string, ConvState>()

export function getConversation(from: string): ConvState {
  return store.get(from) ?? { step: 'start', flaggedForHuman: false, updatedAt: 0 }
}
export function setConversation(from: string, patch: Partial<ConvState>): void {
  const cur = getConversation(from)
  store.set(from, { ...cur, ...patch, updatedAt: Date.now() })
}

// ---------- parseo del webhook entrante ----------
export interface WaIncoming {
  from: string
  kind: 'text' | 'reply' | 'other'
  text?: string
  replyId?: string
  replyTitle?: string
  profileName?: string
}

export function parseIncoming(body: any): WaIncoming | null {
  const value = body?.entry?.[0]?.changes?.[0]?.value
  const msg = value?.messages?.[0]
  if (!msg?.from) return null // statuses (entregado/leído) u otros eventos -> se ignoran
  const from = String(msg.from)
  const profileName = value?.contacts?.[0]?.profile?.name

  if (msg.type === 'text') return { from, kind: 'text', text: msg.text?.body ?? '', profileName }
  if (msg.type === 'interactive') {
    const it = msg.interactive
    if (it?.type === 'button_reply') return { from, kind: 'reply', replyId: it.button_reply?.id, replyTitle: it.button_reply?.title, profileName }
    if (it?.type === 'list_reply') return { from, kind: 'reply', replyId: it.list_reply?.id, replyTitle: it.list_reply?.title, profileName }
  }
  if (msg.type === 'button') return { from, kind: 'reply', replyId: msg.button?.payload ?? msg.button?.text, replyTitle: msg.button?.text, profileName }
  return { from, kind: 'other', profileName }
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
const RESET_WORDS = ['menu', 'menú', 'inicio', 'hola', 'buenas', 'empezar', 'start', 'volver']

function mainMenu(name?: string): WaMessage {
  const saludo = name ? `¡Hola, ${name}! 👋` : '¡Hola! 👋'
  // Lista (no botones): 4 opciones no caben en un mensaje de botones (máx 3).
  return waList(
    `${saludo} Soy el asistente de *Kustom Disfraces* 👽\n¿Qué quieres hacer?`,
    'Ver opciones',
    [
      { id: 'main:ver', title: 'Ver disfraces' },
      { id: 'main:como', title: 'Cómo comprar' },
      { id: 'main:human', title: 'Hablar con alguien' },
      { id: 'main:catalogo', title: 'Ver catálogo 📖' },
    ],
    'Menú',
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
  const rows = getPublicos().map(p => ({
    id: `pub:${p.slug}`,
    title: p.nombre,
    description: p.count ? `${p.count} disfraces` : 'Muy pronto',
  }))
  return waList('¿Para quién es el disfraz? 🎭', 'Ver públicos', rows, 'Públicos')
}

function subcategoriasList(pubSlug: string): WaMessage {
  const pub = getPublico(pubSlug)
  if (!pub) return mainMenu()
  if (!pub.subcategorias.length) {
    const link = `${site()}/categoria/${pub.slug}`
    return waButtons(
      `Estamos cargando más de *${pub.nombre}* 👀\nMíralo en la web 👇\n${link}`,
      [{ id: 'main:ver', title: 'Ver otros' }, { id: 'main:human', title: 'Hablar con alguien' }],
    )
  }
  const rows = pub.subcategorias.map(s => ({
    id: `sub:${pub.slug}:${s.slug}`,
    title: s.nombre,
    description: `${s.count} disfraces`,
  }))
  return waList(`Categorías de *${pub.nombre}* 🎃`, 'Ver categorías', rows, pub.nombre)
}

function subLink(pubSlug: string, subSlug: string): WaMessage {
  const link = `${site()}/categoria/${pubSlug}?sub=${subSlug}`
  const pn = publicoNombre(pubSlug) ?? pubSlug
  const sn = subNombre(pubSlug, subSlug) ?? subSlug
  return waButtons(
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
  return waButtons(
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
    + `📏 Guía de tallas: ${site()}/tallas\n`
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
    return { replies: [mainMenu(input.profileName)], patch: { flaggedForHuman: false, step: 'menu', askedSize: undefined } }
  }

  if (id === 'main:ver') return { replies: [publicosList()], patch: { step: 'publicos', askedSize: undefined } }
  if (id.startsWith('pub:')) return { replies: [subcategoriasList(id.slice(4))], patch: { step: `sub:${id.slice(4)}`, askedSize: undefined } }
  if (id.startsWith('sub:')) {
    const [, pub, sub] = id.split(':')
    return { replies: [subLink(pub, sub)], patch: { step: `link:${pub}:${sub}` } }
  }
  if (id.startsWith('buy:')) {
    const [, pub, sub] = id.split(':')
    return { replies: [buyResend(pub, sub)], patch: { step: `buy:${pub}:${sub}` } }
  }
  if (id === 'main:human' || id === 'human') {
    return { replies: [handoff()], patch: { flaggedForHuman: true, step: 'human', askedSize: undefined } }
  }
  if (id === 'main:como') return { replies: [comoComprar()], patch: { step: 'como', askedSize: undefined } }
  if (id === 'main:catalogo') return { replies: [catalogoLink()], patch: { step: 'catalogo', askedSize: undefined } }
  if (id.startsWith('prod:')) {
    // Ficha desde la lista: usa la talla recordada de la búsqueda para el ✅/⚠️.
    const slug = id.slice(5)
    const p = getProductBySlug(slug)
    if (p) return { replies: [productoFicha(p, state.askedSize ?? null)], patch: { step: `prod:${slug}` } }
  }

  // Texto libre (no comando, no número de menú, no reinicio) -> búsqueda de productos.
  // Los clientes de Marketplace escriben "del hombre araña talla 4", "goku"…
  if (input.kind === 'text' && !isReset && !id && (input.text ?? '').trim()) {
    const res = searchProducts(input.text ?? '')
    if (res && res.matches.length) {
      // Recuerda la talla pedida (o límpiala si esta búsqueda no trae talla).
      const askedSize = res.requestedSize ?? undefined
      if (res.matches.length === 1) {
        return { replies: [productoFicha(res.matches[0], res.requestedSize)], patch: { step: 'ficha', askedSize } }
      }
      return { replies: [resultadosList(res.matches, res.requestedSize)], patch: { step: 'resultados', askedSize } }
    }
    if (res) return { replies: sinResultados(input.text ?? ''), patch: { step: 'sin-resultados', askedSize: undefined } }
    // res === null: sin tokens útiles -> cae al menú de abajo.
  }

  // Cualquier mensaje inicial / texto libre / tipo no soportado -> saludo + menú.
  return { replies: [mainMenu(input.profileName)], patch: { step: 'menu', askedSize: undefined } }
}
