import catalogoData from '~~/app/data/catalogo.json'

/**
 * Búsqueda de productos por texto libre para el bot de WhatsApp. Los clientes que
 * llegan de Marketplace escriben cosas como "del hombre araña talla 4" o "goku".
 *
 * Estrategia: normalizar (minúsculas, sin tildes, tokenizar) → puntuar cada
 * producto visible contra nombre + slug + una tabla de ALIAS (sinónimos y nombres
 * populares) → devolver ordenado por relevancia. Determinista y testeable sin red.
 */

interface RawProduct {
  nombre: string
  slug: string
  precio: number
  tallas: Array<number | string>
  grupo: string
  disponibleWeb?: boolean
}

export interface FoundProduct {
  nombre: string
  slug: string
  precio: number
  tallas: Array<number | string>
  /** Línea del catálogo (super, economico, anime…); agrupa los resultados. */
  grupo: string
}

export interface SearchResult {
  matches: FoundProduct[]
  requestedSize: string | null // talla pedida por el usuario, normalizada ("4", "S", "Bebé")
}

// ---------- normalización ----------
export function normalize(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin tildes
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Palabras vacías: conectores + genéricos que no discriminan producto. "hombre"/
// "mujer" se excluyen como TOKEN (para no cruzar "hombre araña" con "hombre de
// hierro"), pero siguen valiendo como FRASE de alias ("hombre arana" → spider).
const STOP = new Set([
  'del', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o',
  'para', 'por', 'con', 'en', 'a', 'que', 'quiero', 'busco', 'buscar', 'necesito',
  'tienen', 'tiene', 'hay', 'me', 'mi', 'porfa', 'porfavor', 'favor', 'disponible',
  'disfraz', 'disfraces', 'traje', 'costume', 'talla', 'tallas', 'numero', 'num', 't',
  'hombre', 'mujer', 'senor', 'senora', 'nino', 'nina', 'nino', 'bebe',
  // Genéricos en inglés que ensucian ("man" cruza spider-man/iron-man/aquaman).
  // Los alias multi-palabra ("spider man", "super man") siguen valiendo por frase.
  'man', 'woman', 'girl',
])

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(t => t.length >= 2 && !STOP.has(t))
}

// ---------- talla pedida ----------
const SIZE_RE = /\b(?:talla|tallas|numero|num|t)\s*:?\s*(xs|s|m|l|xl|\d{1,2})\b/i

function parseSize(rawNorm: string): { size: string | null, cleaned: string } {
  const m = rawNorm.match(SIZE_RE)
  if (!m) {
    if (/\bbebe\b/.test(rawNorm)) return { size: 'Bebé', cleaned: rawNorm.replace(/\bbebe\b/, ' ') }
    return { size: null, cleaned: rawNorm }
  }
  const val = m[1]
  const size = /^\d+$/.test(val) ? val : val.toUpperCase()
  return { size, cleaned: rawNorm.replace(SIZE_RE, ' ') }
}

/** ¿El producto ofrece la talla pedida? Compara números y letras (S/M/L/XL/Bebé). */
export function hasSize(p: FoundProduct, size: string): boolean {
  return p.tallas.some(t => String(t).toLowerCase() === size.toLowerCase())
}

// ---------- tabla de alias (sinónimos → familia de slugs) ----------
// terms: frases/sinónimos ya normalizados (sin tildes). test: qué slugs cubre.
const ALIAS_GROUPS: Array<{ terms: string[], test: (slug: string) => boolean }> = [
  { terms: ['spider', 'araña', 'arana', 'hombre arana', 'spiderman', 'spider man', 'aranita', 'aranha'], test: s => s.includes('spider') },
  { terms: ['iron spider', 'spider de hierro'], test: s => s.includes('iron-spider') },
  { terms: ['miles morales', 'miles'], test: s => s.includes('miles') },
  { terms: ['spider woman', 'mujer arana', 'spiderwoman'], test: s => s.includes('spider-woman') },
  { terms: ['venom'], test: s => s.includes('venom') },
  { terms: ['superman', 'super man', 'super hombre'], test: s => s.startsWith('superman') },
  { terms: ['super woman', 'superwoman', 'super mujer', 'supermujer'], test: s => s.includes('super-woman') },
  { terms: ['super chica', 'supergirl', 'super girl'], test: s => s.includes('super-chica') },
  { terms: ['iron man', 'ironman', 'hombre de hierro', 'hombre hierro'], test: s => s.startsWith('iron-man') },
  { terms: ['capitan america', 'capi', 'capitan', 'captain america'], test: s => s.includes('capitan-america') },
  { terms: ['capitana america', 'capitana'], test: s => s.includes('capitana') },
  { terms: ['thor'], test: s => s.startsWith('thor') },
  { terms: ['flash'], test: s => s.startsWith('flash') },
  { terms: ['batman', 'bati', 'murcielago'], test: s => s.startsWith('batman') },
  { terms: ['batichica', 'batgirl', 'bati chica', 'bat chica'], test: s => s.includes('batichica') },
  { terms: ['deadpool'], test: s => s.startsWith('deadpool') },
  { terms: ['pantera negra', 'black panther', 'pantera'], test: s => s.includes('pantera') },
  { terms: ['hulk', 'increible hulk'], test: s => s.startsWith('hulk') },
  { terms: ['wolverine', 'logan', 'guepardo'], test: s => s.includes('wolverine') },
  { terms: ['aquaman'], test: s => s.includes('aquaman') },
  { terms: ['buzz', 'buzz lightyear', 'toy story', 'astronauta'], test: s => s.includes('buzz') },
  { terms: ['goku', 'dragon ball', 'dbz', 'dragonball'], test: s => s === 'goku' }, // exacto: "rengoku" contiene "goku"
  { terms: ['anime', 'otaku'], test: s => ['goku', 'tanjiro', 'zenitzu', 'tomioka', 'rengoku', 'nezuko', 'shinobu'].some(a => s.includes(a)) },
  { terms: ['demon slayer', 'kimetsu', 'guardianes de la noche'], test: s => ['tanjiro', 'zenitzu', 'tomioka', 'rengoku', 'nezuko', 'shinobu'].some(a => s.includes(a)) },
  { terms: ['ninja', 'ninjas'], test: s => s.includes('ninja') },
  { terms: ['michael jackson', 'michael', 'thriller'], test: s => s.includes('michael') },
  { terms: ['esqueleto', 'calavera', 'skeleton', 'muerto'], test: s => s.includes('esqueleto') },
  { terms: ['mujer maravilla', 'wonder woman', 'wonderwoman', 'maravilla'], test: s => s.includes('mujer-maravilla') },
  { terms: ['lady bug', 'ladybug', 'miraculous', 'catarina'], test: s => s.includes('lady-bug') },
  { terms: ['elastic girl', 'elastigirl', 'elastica', 'los increibles', 'increibles'], test: s => s.includes('elastic') },
  { terms: ['katrina', 'catrina', 'dia de muertos'], test: s => s.includes('katrina') },
  { terms: ['pollito', 'pollo'], test: s => s.includes('pollito') },
  { terms: ['miquito', 'mico', 'mono', 'monito'], test: s => s.includes('miquito') },
  { terms: ['cerdito', 'cerdo', 'puerco', 'marranito', 'chanchito'], test: s => s.includes('cerdito') },
  { terms: ['perrito', 'perro', 'cachorro'], test: s => s.includes('perrito') },
  { terms: ['vaquita', 'vaca'], test: s => s.includes('vaquita') },
  { terms: ['stitch', 'lilo'], test: s => s.includes('stitch') },
  { terms: ['gato con botas', 'gato', 'gatito'], test: s => s.includes('gato') },
]

// ---------- índice (memoizado) ----------
interface IndexEntry {
  p: FoundProduct
  nameNorm: string // nombre normalizado (frase)
  tokens: Set<string> // tokens de nombre + slug + alias
  phrases: string[] // frases multi-palabra (nombre + alias) para match por frase
}

let INDEX: IndexEntry[] | null = null

function buildIndex(): IndexEntry[] {
  if (INDEX) return INDEX
  const products = (catalogoData as unknown as RawProduct[]).filter(p => p.disponibleWeb === true)
  INDEX = products.map((p) => {
    const nameNorm = normalize(p.nombre)
    const slugNorm = p.slug.replace(/-/g, ' ')
    const aliasTerms = ALIAS_GROUPS.filter(g => g.test(p.slug)).flatMap(g => g.terms)
    const tokenSet = new Set<string>()
    for (const src of [nameNorm, slugNorm, ...aliasTerms]) {
      for (const tok of normalize(src).split(' ')) if (tok.length >= 2) tokenSet.add(tok)
    }
    const phrases = [nameNorm, ...aliasTerms.map(normalize)].filter(x => x.includes(' '))
    return {
      p: { nombre: p.nombre, slug: p.slug, precio: p.precio, tallas: p.tallas, grupo: p.grupo },
      nameNorm,
      tokens: tokenSet,
      phrases,
    }
  })
  return INDEX
}

function tokenMatches(qt: string, tokens: Set<string>): boolean {
  if (tokens.has(qt)) return true
  if (qt.length < 4) return false
  for (const h of tokens) {
    if (h.length >= 4 && (h.startsWith(qt) || qt.startsWith(h))) return true
  }
  return false
}

/**
 * Busca productos por texto libre. Devuelve null si no hay tokens útiles (p. ej.
 * solo un número o palabras vacías) — el bot cae al menú en ese caso.
 */
export function searchProducts(query: string, limit = 8): SearchResult | null {
  const rawNorm = normalize(query)
  const { size, cleaned } = parseSize(rawNorm)
  const tokens = tokenize(cleaned)
  if (!tokens.length) return null

  const scored = buildIndex().map((e) => {
    const phraseScore = e.phrases.filter(ph => rawNorm.includes(ph)).length
    // Nombre completo mencionado (p. ej. "batman") = señal fuerte.
    const nameHit = rawNorm.includes(e.nameNorm) ? 1 : 0
    const tokenScore = tokens.filter(t => tokenMatches(t, e.tokens)).length
    const base = phraseScore * 10 + nameHit * 5 + tokenScore
    // La talla NUNCA califica por sí sola: solo desempata entre coincidencias de
    // texto (si no, "talla 6" traería todo producto que tenga esa talla).
    const sizeBonus = base > 0 && size && hasSize(e.p, size) ? 0.5 : 0
    return { e, score: base + sizeBonus }
  }).filter(x => x.score > 0)

  scored.sort((a, b) => b.score - a.score || a.e.p.precio - b.e.p.precio)

  return { matches: scored.slice(0, limit).map(x => x.e.p), requestedSize: size }
}

/** Rango de precios del catálogo visible (para la respuesta general de "¿precios?"). */
export function priceRange(): { min: number, max: number } {
  const precios = buildIndex().map(e => e.p.precio).filter(n => Number.isFinite(n) && n > 0)
  if (!precios.length) return { min: 0, max: 0 }
  return { min: Math.min(...precios), max: Math.max(...precios) }
}

/** Lookup directo por slug (no búsqueda difusa). undefined si no existe/visible. */
export function getProductBySlug(slug: string): FoundProduct | undefined {
  return buildIndex().find(e => e.p.slug === slug)?.p
}

/**
 * Vocabulario de búsqueda: todos los tokens conocidos del índice (nombre + slug +
 * alias). Aditivo — NO afecta a searchProducts. Lo usa la capa de intención omnicanal
 * (server/utils/botReplies.ts) como objetivo de corrección Levenshtein.
 */
export function searchVocabulary(): Set<string> {
  const vocab = new Set<string>()
  for (const e of buildIndex()) for (const t of e.tokens) if (t.length >= 3) vocab.add(t)
  return vocab
}

/** Formato de precio colombiano: 130000 → "$130.000". Agrupación manual (no
 *  depende del ICU de Node, que puede faltar en algunos runtimes). */
export function formatCOP(n: number): string {
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
