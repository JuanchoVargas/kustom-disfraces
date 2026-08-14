import type { WaMessage } from './whatsapp'
import { waButtons, waList, waText } from './whatsapp'
import { getPublico, getPublicos, publicoNombre, subNombre } from './catalogNav'

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
export interface ConvState { step: string, flaggedForHuman: boolean, updatedAt: number }
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

// ---------- helpers de contenido ----------
const site = () => (useRuntimeConfig().public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
const RESET_WORDS = ['menu', 'menú', 'inicio', 'hola', 'buenas', 'empezar', 'start', 'volver']

function mainMenu(name?: string): WaMessage {
  const saludo = name ? `¡Hola, ${name}! 👋` : '¡Hola! 👋'
  return waButtons(
    `${saludo} Soy el asistente de *Kustom Disfraces* 👽\n¿Qué quieres hacer?`,
    [
      { id: 'main:ver', title: 'Ver disfraces' },
      { id: 'main:como', title: 'Cómo comprar' },
      { id: 'main:human', title: 'Hablar con alguien' },
    ],
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

// ---------- árbol de decisión ----------
export interface BotResult { replies: WaMessage[], patch: Partial<ConvState> }

export function buildBotReplies(input: WaIncoming, state: ConvState): BotResult {
  const id = input.kind === 'reply' ? (input.replyId ?? '') : ''
  const text = (input.text ?? '').trim().toLowerCase()
  const isReset = RESET_WORDS.includes(text)

  // Conversación marcada para atención humana: el bot NO interrumpe. Solo una
  // palabra de reinicio (p. ej. "menú") lo reactiva.
  if (state.flaggedForHuman) {
    if (!isReset) return { replies: [], patch: {} }
    return { replies: [mainMenu(input.profileName)], patch: { flaggedForHuman: false, step: 'menu' } }
  }

  if (id === 'main:ver') return { replies: [publicosList()], patch: { step: 'publicos' } }
  if (id.startsWith('pub:')) return { replies: [subcategoriasList(id.slice(4))], patch: { step: `sub:${id.slice(4)}` } }
  if (id.startsWith('sub:')) {
    const [, pub, sub] = id.split(':')
    return { replies: [subLink(pub, sub)], patch: { step: `link:${pub}:${sub}` } }
  }
  if (id.startsWith('buy:')) {
    const [, pub, sub] = id.split(':')
    return { replies: [buyResend(pub, sub)], patch: { step: `buy:${pub}:${sub}` } }
  }
  if (id === 'main:human' || id === 'human') {
    return { replies: [handoff()], patch: { flaggedForHuman: true, step: 'human' } }
  }
  if (id === 'main:como') return { replies: [comoComprar()], patch: { step: 'como' } }

  // Cualquier mensaje inicial / texto libre / tipo no soportado -> saludo + menú.
  return { replies: [mainMenu(input.profileName)], patch: { step: 'menu' } }
}
