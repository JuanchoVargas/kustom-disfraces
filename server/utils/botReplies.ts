import type { WaMessage } from './whatsapp'
import type { ConvState, WaIncoming } from './whatsappBot'
import { interactiveOptions, waButtons, waText } from './whatsapp'
import { buildBotReplies } from './whatsappBot'
import { publicoNombre } from './catalogNav'
import { normalize, searchProducts, searchVocabulary } from './productSearch'

/**
 * Capa de intención OMNICANAL (WhatsApp + Messenger/Instagram). Envuelve al cerebro
 * base (buildBotReplies: menús, navegación, fichas, resultados) y le añade memoria
 * por "slots" + tolerancia a lenguaje natural (saludos, typos, palabras de precio)
 * + tips de búsqueda directa. Ambos webhooks entran por buildReplies(); lo específico
 * de cada canal (quick replies vs chunking/texto) vive en su adaptador de salida.
 */

export interface BotResult { replies: WaMessage[], patch: Partial<ConvState> }

const site = () => (useRuntimeConfig().public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
const SLOT_TTL = 30 * 60 * 1000 // 30 min

// ---------- vocabularios ----------
const PRICE_WORDS = new Set(['precio', 'precios', 'piecio', 'preci', 'cuanto', 'cuantos', 'vale', 'valen', 'cuesta', 'cuestan', 'q'])
const GENERIC_WORDS = new Set(['traje', 'trajes', 'disfraz', 'disfraces', 'disfracez', 'disfrazes', 'cosa', 'cosas', 'algo', 'tipo', 'estilo', 'modelo'])
// Conectores/palabras vacías (para decidir si QUEDA algún token de producto). No se
// usan para la BÚSQUEDA (esa recibe la frase completa, para que los alias por frase
// como "hombre arana" sigan funcionando), solo para clasificar la intención.
const CONNECTORS = new Set(['de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'para', 'por', 'con', 'en', 'a', 'que', 'al', 'lo', 'me', 'mi', 'te', 'se', 'tiene', 'tienen', 'tienes', 'tenes', 'hay', 'busco', 'quiero', 'necesito', 'ver', 'mira', 'quisiera', 'queria', 'este', 'esta', 'ese', 'esa', 'esos', 'esas', 'estos', 'estas', 'eso', 'esto', 'aqui', 'ahi', 'cual', 'cuales', 'algun', 'alguna'])
const BACK_WORDS = new Set(['volver', 'atras', 'regresar'])
const RESET_WORDS = new Set(['menu', 'inicio', 'empezar', 'start'])
// palabra de público (normalizada, sin tildes) → slug de catalogNav.
const PUBLICO_WORDS: Record<string, string> = {
  nino: 'ninos', ninos: 'ninos', nina: 'ninas', ninas: 'ninas',
  bebe: 'bebes', bebes: 'bebes', dama: 'damas', damas: 'damas',
  caballero: 'caballeros', caballeros: 'caballeros',
  hombre: 'caballeros', hombres: 'caballeros', mujer: 'damas', mujeres: 'damas',
}

// ---------- saludos ----------
function isGreetTok(t: string): boolean {
  if (/^h?ola+s?$/.test(t)) return true // hola, holaa, ola, olas
  if (/^hol[ai]+s?$/.test(t)) return true // holi, holis
  if (/^(buenas?|buenos?|buen)$/.test(t)) return true
  if (/^(dias?|tardes?|noches?)$/.test(t)) return true
  if (/^(hey+|hi|hello|saludos|que|tal)$/.test(t)) return true
  return false
}
function isSaludo(text: string): boolean {
  const s = normalize(text).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return false
  return s.split(' ').every(isGreetTok)
}

// ---------- typos (Levenshtein ≤ 2 por token) ----------
function lev(a: string, b: string, max: number): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > max) return max + 1
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[n]
}

let VOCAB: Set<string> | null = null
const vocab = () => (VOCAB ??= searchVocabulary())

/**
 * Corrige cada token al vocabulario más cercano. Conservador para no inventar
 * productos: solo tokens len ≥ 4 que no sean público/precio/genérico/conector; el
 * candidato debe tener len ≥ 4; y se exige d ≤ 1 para tokens de 4 chars (d ≤ 2 solo
 * desde 5). Así "hombra→hombre", "aranas→arana", pero "diosa" NO se vuelve "dia".
 */
function typoFix(str: string): string {
  const v = vocab()
  return str.split(' ').map((t) => {
    if (t.length < 4 || PRICE_WORDS.has(t) || GENERIC_WORDS.has(t) || CONNECTORS.has(t) || PUBLICO_WORDS[t]) return t
    if (v.has(t)) return t
    const maxD = t.length >= 5 ? 2 : 1
    let best = t, bestD = maxD + 1
    for (const cand of v) {
      if (cand.length < 4 || Math.abs(cand.length - t.length) > 2) continue
      const d = lev(t, cand, maxD)
      if (d < bestD) { bestD = d; best = cand; if (d === 1) break }
    }
    return bestD <= maxD ? best : t
  }).join(' ')
}

// ---------- extracción de talla / público ----------
function extractTalla(norm: string): { talla: string | null, rest: string } {
  const m = norm.match(/\b(?:tallas?|t)\s*:?\s*(\d{1,2})\b/)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    if (n >= 0 && n <= 14) return { talla: String(n), rest: norm.replace(m[0], ' ') }
  }
  return { talla: null, rest: norm }
}
const PUBLICO_SET = new Set(Object.keys(PUBLICO_WORDS))
function extractPublico(norm: string): string | null {
  for (const t of norm.split(' ')) if (PUBLICO_WORDS[t]) return PUBLICO_WORDS[t]
  return null
}
function stripWords(norm: string, ...sets: Set<string>[]): string {
  return norm.split(' ').filter(t => t && !sets.some(s => s.has(t))).join(' ')
}

// ---------- slots ----------
function liveSlots(state: ConvState): NonNullable<ConvState['slots']> {
  const s = state.slots
  if (!s || (Date.now() - (s.updatedAt ?? 0)) > SLOT_TTL) return {}
  return s
}
function mergeSlots(prev: NonNullable<ConvState['slots']>, patch: { producto?: string | undefined, talla?: string | undefined, publico?: string | undefined }): NonNullable<ConvState['slots']> {
  return {
    producto: 'producto' in patch ? patch.producto : prev.producto,
    talla: 'talla' in patch ? patch.talla : prev.talla,
    publico: 'publico' in patch ? patch.publico : prev.publico,
    updatedAt: Date.now(),
  }
}
function withSlots(res: BotResult, prev: NonNullable<ConvState['slots']>, patch: Parameters<typeof mergeSlots>[1]): BotResult {
  return { replies: res.replies, patch: { ...res.patch, slots: mergeSlots(prev, patch) } }
}

// ---------- respuestas específicas del canal ----------
function welcome(input: WaIncoming, state: ConvState): BotResult {
  const del = buildBotReplies({ from: input.from, kind: 'text', text: 'menu', profileName: input.profileName }, state)
  return { replies: del.replies, patch: { ...del.patch, slots: undefined } }
}

function cloneWithBody(m: WaMessage, text: string): WaMessage {
  if (m.type !== 'interactive') return m
  const it = m.interactive as any
  return { type: 'interactive', interactive: { ...it, body: { ...it.body, text } } }
}

/** Solo público: pregunta el personaje + quick replies de las categorías del público. */
function promptPersonaje(publico: string, input: WaIncoming, state: ConvState, slots: NonNullable<ConvState['slots']>): BotResult {
  const del = buildBotReplies({ from: input.from, kind: 'reply', replyId: `pub:${publico}` }, state)
  const nombre = publicoNombre(publico) ?? publico
  const first = del.replies[0]
  const opts = first ? (interactiveOptions(first) ?? []) : []
  const replies = opts.some(o => o.id.startsWith('sub:'))
    ? [cloneWithBody(first, `¿Qué personaje buscas para *${nombre}*? 😊`), ...del.replies.slice(1)]
    : del.replies
  return { replies, patch: { ...del.patch, slots: mergeSlots(slots, { publico }) } }
}

/** Solo talla (sin producto vivo): la guarda y pide el personaje. */
function askPersonaje(state: ConvState, slots: NonNullable<ConvState['slots']>, patch: { talla?: string }): BotResult {
  return {
    replies: [waButtons(`¡Anoté tu talla *${patch.talla}*! 👌 ¿Qué personaje o disfraz buscas? 😊`, [
      { id: 'main:ver', title: 'Ver categorías' },
      { id: 'main:menu', title: '🏠 Menú' },
    ])],
    patch: { step: 'ask-personaje', stack: [], slots: mergeSlots(slots, patch) },
  }
}

/** 0 coincidencias: copy + link al PDF + acciones. */
function sinResultados(state: ConvState, slots: NonNullable<ConvState['slots']>): BotResult {
  return {
    replies: [waButtons(
      `No tenemos ese disfraz por ahora 😔. Mira el catálogo completo aquí 👇\n${site()}/catalogo-kustom.pdf`,
      [{ id: 'main:catalogo', title: 'Ver catálogo' }, { id: 'main:human', title: 'Hablar con alguien' }, { id: 'main:menu', title: '🏠 Menú' }],
    )],
    patch: { step: 'sin-resultados', stack: [], slots: mergeSlots(slots, {}) },
  }
}

// ---------- núcleo de texto ----------
// Roles que significan "una persona del equipo" cuando se piden EXPLÍCITAMENTE.
const HUMAN_ROLE = '(asesora?|agente|humanos?|humanas?|vendedora?|operadora?)'

/**
 * ¿Pide atención humana por texto? SOLO con frases explícitas: el mensaje ES el
 * pedido ("un asesor", "asesor por favor", "humano") o hay verbo de intención +
 * rol/persona ("quiero hablar con alguien", "necesito un asesor", "que me atienda
 * una persona"). Un rol suelto en mitad de una frase YA NO dispara: antes "disfraz
 * de agente secreto" o "traje de vendedor" mandaban la conversación a handoff y el
 * bot quedaba mudo. El texto llega ya normalizado (minúsculas, sin tildes).
 */
function isHumanRequest(norm: string): boolean {
  // Mensaje que ES el pedido: "asesor", "un asesor porfa", "humano por favor".
  if (new RegExp(`^(una? |el |la )?${HUMAN_ROLE}( por ?favor| porfa+| porfis| pf)?$`).test(norm.trim())) return true
  // Verbo de comunicación + con quién (cerca, no en cualquier parte de la frase).
  if (new RegExp(`\\b(hablar|habla|chatear|comunicar(me|se)?|contactar(me)?|escribirle)\\b.{0,30}\\b(alguien|una persona|${HUMAN_ROLE}|equipo|ustedes|encargad[oa])\\b`).test(norm)) return true
  // "necesito/quiero/busco/pasame (a) un asesor/agente/humano…" (rol explícito, no "persona"
  // ni "alguien" sueltos: "quiero un disfraz para una persona adulta" NO es handoff). Si la
  // frase habla de producto ("busco disfraz de agente secreto"), esta regla NO aplica.
  const hablaDeProducto = /\b(disfraz|disfraces|disfracez|traje|trajes|talla|tallas)\b/.test(norm)
  if (!hablaDeProducto && new RegExp(`\\b(necesito|quiero|busco|pasa(me|r)|pon(me|ga)|comunique(me)?)\\b.{0,20}\\b${HUMAN_ROLE}\\b`).test(norm)) return true
  // "que me atienda alguien / una persona", "atencion humana".
  if (/\b(atiende|atienda|atiendan|atenderme|atencion)\b.{0,20}\b(alguien|una persona|human[oa])\b/.test(norm)) return true
  if (/\b(alguien|persona)\b.{0,20}\b(me atienda|me ayude|real|de verdad)\b/.test(norm)) return true
  return false
}

function handleText(input: WaIncoming, state: ConvState): BotResult {
  const text = (input.text ?? '').trim()
  const norm = normalize(text)
  const slots = liveSlots(state)

  // Número puro → selección silenciosa por lastMenu (reusa el cerebro; sin copy numérico).
  if (/^\d+$/.test(text) && state.lastMenu?.length) return withSlots(buildBotReplies(input, state), slots, {})
  // "volver"/"atrás" escrito → back del cerebro (mantiene slots).
  if (BACK_WORDS.has(norm)) return withSlots(buildBotReplies(input, state), slots, {})
  // Saludo o "menú"/"inicio" → bienvenida y LIMPIA slots.
  if (isSaludo(text) || RESET_WORDS.has(norm)) return welcome(input, state)
  // "quiero hablar con alguien / un asesor / una persona" escrito → handoff a humano
  // (mismo camino que el botón "Hablar con alguien"). La bandeja lo recoge como
  // estado=humano + no leído y avisa a ventas@ (ver botSession.ts).
  if (isHumanRequest(norm)) return withSlots(buildBotReplies({ ...input, kind: 'reply', replyId: 'main:human' }, state), slots, {})

  // Extracción: precio → fuera; talla → fuera; público (para memoria/prompt).
  const priceStripped = stripWords(norm, PRICE_WORDS)
  const { talla, rest } = extractTalla(priceStripped)
  const publico = extractPublico(rest)
  // ¿Queda algún token de PRODUCTO? (quitando conectores/genéricos/público). Se decide
  // con el texto crudo, ANTES de typoFix, para no clasificar por una corrección espuria.
  const productoRaw = stripWords(rest, CONNECTORS, GENERIC_WORDS, PUBLICO_SET)
  const hasProducto = productoRaw.trim().length > 0
  // La BÚSQUEDA sí recibe la frase completa typo-corregida (alias por frase incluidos).
  const fixed = typoFix(rest)
  const res = searchProducts(fixed)

  // Producto encontrado. Se delega al cerebro para reusar su formato: 1 coincidencia
  // → ficha directa (con ✅/⚠️ de talla), >1 → lista de variantes con precio. La talla
  // combinada (esta o previa) se inyecta en el query para que la ficha/lista la usen.
  if (res && res.matches.length) {
    const talla2 = talla ?? slots.talla ?? undefined
    const query = talla2 ? `${fixed} talla ${talla2}` : fixed
    const del = buildBotReplies({ from: input.from, kind: 'text', text: query, profileName: input.profileName }, state)
    // Se recuerda el mejor match como producto activo (para re-precio "¿cuánto vale?").
    return withSlots(del, slots, { producto: res.matches[0].slug, talla: talla2 })
  }

  // Había términos de producto pero SIN coincidencia (p. ej. "diosa griega") → sin resultados.
  if (hasProducto) return sinResultados(state, slots)

  // Sin término de producto → público / talla / producto vivo / bienvenida.
  if (publico) return promptPersonaje(publico, input, state, slots)
  if (talla) {
    if (slots.producto) {
      const del = buildBotReplies({ from: input.from, kind: 'reply', replyId: `prod:${slots.producto}` }, { ...state, askedSize: talla })
      return withSlots(del, slots, { talla })
    }
    return askPersonaje(state, slots, { talla })
  }
  // Mensaje suelto (p. ej. pregunta de precio) con un producto vivo → re-muestra ficha.
  if (slots.producto) {
    const del = buildBotReplies({ from: input.from, kind: 'reply', replyId: `prod:${slots.producto}` }, { ...state, askedSize: slots.talla ?? undefined })
    return withSlots(del, slots, {})
  }
  return welcome(input, state)
}

// Invitaciones a la búsqueda directa (OMNICANAL). Se anexan al cuerpo del primer
// mensaje según el `step`, sin tocar los builders compartidos (se agregan aquí,
// después). Un 💡 corto, sin recargar.
const TIP_MENU = '💡 O escríbeme lo que buscas y te lo encuentro. Ej: *spiderman talla 6*'
const TIP_PUBLICOS = '💡 Si ya sabes cuál quieres, solo escríbelo.'
const TIP_SUBLINK = '💡 ¿Buscas algo específico? Escríbeme el nombre y te lo busco.'

function withTip(res: BotResult): BotResult {
  const step = res.patch?.step
  const tip = step === 'menu' ? TIP_MENU
    : step === 'publicos' ? TIP_PUBLICOS
      : (typeof step === 'string' && step.startsWith('link:')) ? TIP_SUBLINK
        : null
  const first = res.replies[0]
  if (!tip || first?.type !== 'interactive') return res
  const it = first.interactive as any
  const withBody: WaMessage = { type: 'interactive', interactive: { ...it, body: { ...it.body, text: `${String(it?.body?.text ?? '')}\n${tip}` } } }
  return { replies: [withBody, ...res.replies.slice(1)], patch: res.patch }
}

/**
 * Punto de entrada OMNICANAL. Taps (quick_reply/postback/botón) van al cerebro tal
 * cual (ids idénticos); "🏠 Menú" (main:menu) limpia slots; el texto pasa por la capa
 * de slots/lenguaje natural. Al final se anexan las invitaciones a búsqueda directa
 * (menú de bienvenida, públicos, subLink).
 */
export function buildReplies(input: WaIncoming, state: ConvState): BotResult {
  return withTip(_route(input, state))
}

function _route(input: WaIncoming, state: ConvState): BotResult {
  // Handoff pendiente (el cliente pidió hablar con alguien): el bot CALLA. Solo un
  // saludo/"menú" (o el botón 🏠 Menú) lo reactiva. Antes esta capa buscaba
  // producto en cualquier texto y pisaba el silencio del cerebro base.
  if (state.flaggedForHuman) {
    const text = (input.text ?? '').trim()
    const revive = (input.kind === 'reply' && input.replyId === 'main:menu')
      || (input.kind === 'text' && (isSaludo(text) || RESET_WORDS.has(normalize(text))))
    if (!revive) return { replies: [], patch: {} }
    return welcome(input, state)
  }
  if (input.kind === 'reply') {
    if (input.replyId === 'main:menu') return welcome(input, state)
    return buildBotReplies(input, state)
  }
  if (input.kind === 'text') return handleText(input, state)
  return welcome(input, state)
}
