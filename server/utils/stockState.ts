import type { InvProduct, InvVariation } from '~~/shared/types/inventory'
import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import { stockBajoUmbral } from './inventoryCommon'
import { variationSku } from '~~/shared/utils/tallas'
import catalogoData from '~~/app/data/catalogo.json'

/**
 * ESTADO DE STOCK para el sitio público, el bot y el checkout (lógica de agotado).
 *
 * Fuente: el adaptador de inventario activo (mock = snapshot + sobreescrituras;
 * woo = snapshot). Se calcula UNA vez por ventana de 2 min por instancia.
 *
 * ¿Se aplica? NUXT_INVENTORY_PUBLIC_STOCK:
 *   auto (default) → solo con adaptador woo (el mock es simulación y el panel
 *                    promete "los cambios no se reflejan en el sitio").
 *   on             → también con mock (pruebas en local / preview).
 *   off            → nunca (el sitio vende sin mirar stock, como antes).
 * Cuando NO se aplica, todo devuelve "nada agotado" y el checkout no bloquea.
 *
 * Reglas:
 *   - talla agotada  = variación con gestión activa y cantidad ≤ 0 (o outofstock).
 *   - producto agotado = tiene tallas y TODAS están agotadas.
 *   - talla sin gestionar = disponible (Woo hace lo mismo).
 */

export interface StockState {
  enabled: boolean
  backend: 'mock' | 'woo'
  /** códigos de producto totalmente agotados */
  agotados: Set<string>
  /** código → tallas agotadas (como texto: "4", "Bebé") */
  tallasAgotadas: Map<string, string[]>
  /** SKU de variación → cantidad disponible (null = sin gestionar) */
  disponible: Map<string, number | null>
  /** tallas con 0 < cantidad ≤ umbral */
  bajo: { sku: string, producto: string, talla: string, cantidad: number }[]
  /** tallas agotadas (detalle para alertas) */
  agotadas: { sku: string, producto: string, talla: string }[]
  /**
   * Entradas de NUXT_SKUS_AGOTADOS cuyo SKU no existe en ningún catálogo. No se
   * aplican (antes se agotaba un código fantasma en silencio) y el panel las avisa.
   */
  forzadosNoEncontrados: string[]
  umbral: number
  updated_at: string
}

const TTL_MS = 2 * 60 * 1000
let cache: { at: number, state: StockState } | null = null

export function publicStockEnabled(): boolean {
  const mode = String(useRuntimeConfig().inventoryPublicStock || 'auto')
  if (mode === 'on') return true
  if (mode === 'off') return false
  return getInventoryStore().backend === 'woo'
}

const tallaDe = (v: InvVariation) => String(v.attributes.find(a => a.name === 'Talla')?.option ?? v.sku.slice(v.sku.lastIndexOf('-T') + 2))
const agotada = (v: InvVariation) => (v.manage_stock && (v.stock_quantity ?? 0) <= 0) || v.stock_status === 'outofstock'

/**
 * ⚠️ OVERRIDE TEMPORAL DE AGOTADOS — NUXT_SKUS_AGOTADOS.
 *
 * Mientras el stock real no esté cargado en el inventario, esta lista marca
 * referencias como agotadas a mano. Acepta, separados por coma:
 *   - código de producto (001011001) → la referencia completa queda agotada
 *   - SKU de talla     (001011001-T4) → solo esa talla
 * y cada entrada admite un motivo detrás de ":" ("001011004:falta el dato").
 *
 * ⚠️ El motivo NO puede llevar comas: la coma separa entradas, así que
 * "001011004:falta stock, pregunta a ventas" parte en dos y el trozo
 * " pregunta a ventas" se lee como otro SKU. Por eso todo SKU se valida contra
 * el catálogo y lo que no existe se reporta en el panel (ver validarForzados).
 *
 * Es la ÚNICA fuente del agotado forzado: de aquí salen la cinta AGOTADO de la
 * web, la exclusión del bot y el bloqueo del carrito y el checkout. No dupliques
 * la lista en ningún otro sitio.
 *
 * ELIMINAR ESTE OVERRIDE (y la variable) CUANDO EL STOCK REAL ESTÉ CARGADO: a
 * partir de ahí el agotado sale solo de stock = 0 y esto sobra.
 */
export function skusAgotadosOverride(): { productos: Set<string>, variaciones: Set<string>, motivos: Map<string, string> } {
  const productos = new Set<string>()
  const variaciones = new Set<string>()
  const motivos = new Map<string, string>()
  for (const t of String(useRuntimeConfig().skusAgotados || '').split(',').map(s => s.trim()).filter(Boolean)) {
    // "SKU" o "SKU:motivo" — el motivo queda escrito junto al forzado y se ve en el
    // panel, para que nadie tenga que adivinar por qué una referencia está agotada
    // a mano (p. ej. "001011004:dato faltante" = falta cargar el stock de esa talla).
    const i = t.indexOf(':')
    const sku = (i >= 0 ? t.slice(0, i) : t).trim()
    const motivo = i >= 0 ? t.slice(i + 1).trim() : ''
    if (!sku) continue
    if (motivo) motivos.set(sku, motivo)
    if (sku.includes('-T')) variaciones.add(sku)
    else productos.add(sku)
  }
  return { productos, variaciones, motivos }
}

/**
 * Qué SKU EXISTEN. Unión de catalogo.json (taxonomía estable de la web) y del
 * inventario cargado (snapshot de Woo), porque a cada fuente le falta algo de la
 * otra: hay borradores en Woo que no están en la web y productos de la web que el
 * snapshot todavía no trajo. Solo lo que no aparece en NINGUNA de las dos es un
 * valor inválido, así que un SKU real nunca se descarta por snapshot incompleto.
 */
function catalogoConocido(products: InvProduct[]): { codigos: Set<string>, variaciones: Set<string> } {
  const codigos = new Set<string>()
  const variaciones = new Set<string>()
  for (const l of catalogoData as ProductoCatalogo[]) {
    codigos.add(l.codigo)
    for (const t of l.tallas ?? []) variaciones.add(variationSku(l.codigo, t))
  }
  for (const p of products) {
    codigos.add(p.sku)
    for (const v of p.variations) variaciones.add(v.sku)
  }
  return { codigos, variaciones }
}

/**
 * Separa el override en lo aplicable y lo que no existe. Un SKU inventado (un
 * dedazo, o el trozo que queda cuando alguien mete una coma dentro del motivo)
 * ya NO se agota en silencio: sale reportado para que se corrija la variable.
 */
export function validarForzados(products: InvProduct[]): {
  productos: Set<string>
  variaciones: Set<string>
  motivos: Map<string, string>
  noEncontrados: string[]
} {
  const ov = skusAgotadosOverride()
  const conocido = catalogoConocido(products)
  const productos = new Set<string>()
  const variaciones = new Set<string>()
  const noEncontrados: string[] = []
  for (const sku of ov.productos) {
    if (conocido.codigos.has(sku)) productos.add(sku)
    else noEncontrados.push(sku)
  }
  for (const sku of ov.variaciones) {
    if (conocido.variaciones.has(sku)) variaciones.add(sku)
    else noEncontrados.push(sku)
  }
  return { productos, variaciones, motivos: ov.motivos, noEncontrados }
}

/** Lo que el panel muestra: qué está forzado a agotado y por qué. */
export function agotadosForzados(): { sku: string, motivo: string }[] {
  const { productos, variaciones, motivos } = skusAgotadosOverride()
  return [...productos, ...variaciones].map(sku => ({ sku, motivo: motivos.get(sku) || 'forzado a mano mientras se carga el stock real' }))
}

export function computeStockState(products: InvProduct[], enabled: boolean, backend: 'mock' | 'woo'): StockState {
  const umbral = stockBajoUmbral()
  const ov = validarForzados(products)
  const forzados = ov.productos.size > 0 || ov.variaciones.size > 0
  if (ov.noEncontrados.length) {
    console.warn(`[stock] NUXT_SKUS_AGOTADOS: ${ov.noEncontrados.length} valor(es) sin producto en el catálogo (se ignoran): ${ov.noEncontrados.join(' · ')}`)
  }
  const st: StockState = {
    // El override enciende la lógica de agotado aunque el adaptador todavía no se
    // aplique al sitio, pero SOLO para lo que nombra (ver `disponible` abajo).
    enabled: enabled || forzados,
    backend,
    agotados: new Set(),
    tallasAgotadas: new Map(),
    disponible: new Map(),
    bajo: [],
    agotadas: [],
    forzadosNoEncontrados: ov.noEncontrados,
    umbral,
    updated_at: new Date().toISOString(),
  }
  for (const p of products) {
    const outs: string[] = []
    const productoForzado = ov.productos.has(p.sku)
    for (const v of p.variations) {
      const forzada = productoForzado || ov.variaciones.has(v.sku)
      // Cantidad que ve el checkout. Con el stock real aún sin aplicar, solo las
      // referencias del override quedan en 0; el resto va como "sin gestionar"
      // (null) para no bloquear ninguna venta que antes pasaba.
      st.disponible.set(v.sku, forzada ? 0 : (enabled ? (v.manage_stock ? (v.stock_quantity ?? 0) : null) : null))
      // El agotado real solo cuenta si el adaptador SÍ se aplica al sitio: en modo
      // práctica (mock) sus cantidades son simuladas y no deben salir a la web.
      if (forzada || (enabled && agotada(v))) outs.push(tallaDe(v))
      // Los contadores del panel reflejan el inventario REAL, no el override.
      if (agotada(v)) {
        if (p.status === 'publish') st.agotadas.push({ sku: v.sku, producto: p.name, talla: tallaDe(v) })
      }
      else if (v.manage_stock && (v.stock_quantity ?? 0) <= umbral && p.status === 'publish') {
        st.bajo.push({ sku: v.sku, producto: p.name, talla: tallaDe(v), cantidad: v.stock_quantity ?? 0 })
      }
    }
    if (outs.length) st.tallasAgotadas.set(p.sku, outs)
    if (p.variations.length && outs.length === p.variations.length) st.agotados.add(p.sku)
  }
  // Un código del override que el inventario todavía no conozca (sin snapshot, sin
  // variaciones) igual queda agotado: si no, la cinta no saldría. Solo llegan aquí
  // códigos que SÍ existen en algún catálogo; los inventados ya se apartaron.
  for (const codigo of ov.productos) st.agotados.add(codigo)
  return st
}

async function allProducts(): Promise<InvProduct[]> {
  const store = getInventoryStore()
  const first = await store.listProducts({ page: 1, per_page: 100 })
  const out = [...first.items]
  for (let page = 2; page <= first.total_pages; page++) out.push(...(await store.listProducts({ page, per_page: 100 })).items)
  return out
}

/** Estado de stock (cacheado 2 min). `force` recalcula ya (tras una escritura del panel). */
export async function getStockState(force = false): Promise<StockState> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.state
  const enabled = publicStockEnabled()
  const backend = getInventoryStore().backend
  let state: StockState
  try {
    state = computeStockState(await allProducts(), enabled, backend)
  }
  catch (err) {
    // Sin inventario legible (BD caída, etc.): el sitio sigue vendiendo como antes.
    console.error('[stock] no se pudo calcular el estado de stock; se asume todo disponible:', String((err as Error)?.message ?? err))
    state = computeStockState([], enabled, backend)
  }
  cache = { at: Date.now(), state }
  return state
}

export function invalidateStockState(): void {
  cache = null
}

/** Versión pública (sin cantidades): lo que consume el sitio. */
export async function publicStockPayload(): Promise<{ enabled: boolean, agotados: string[], tallas: Record<string, string[]>, updated_at: string }> {
  const st = await getStockState()
  if (!st.enabled) return { enabled: false, agotados: [], tallas: {}, updated_at: st.updated_at }
  return { enabled: true, agotados: [...st.agotados], tallas: Object.fromEntries(st.tallasAgotadas), updated_at: st.updated_at }
}

export interface StockProblem { sku: string, size: string, pedido: number, disponible: number }

/**
 * Validación para el CHECKOUT: ítems {sku, size, quantity} contra el adaptador.
 * Devuelve los que no alcanzan. Sin talla o talla sin gestionar → pasa.
 */
export async function checkStockFor(items: { sku: string, size?: string | number | null, quantity: number }[]): Promise<StockProblem[]> {
  const st = await getStockState()
  if (!st.enabled) return []
  const problems: StockProblem[] = []
  // Varias líneas del carrito con la misma talla suman.
  const pedido = new Map<string, { sku: string, size: string, qty: number }>()
  for (const it of items) {
    if (it.size === null || it.size === undefined || it.size === '') continue
    const vsku = variationSku(it.sku, it.size)
    const prev = pedido.get(vsku)
    if (prev) prev.qty += it.quantity
    else pedido.set(vsku, { sku: it.sku, size: String(it.size), qty: it.quantity })
  }
  for (const [vsku, p] of pedido) {
    if (!st.disponible.has(vsku)) continue // variación desconocida para el inventario: no se bloquea
    const disp = st.disponible.get(vsku)
    if (disp === null || disp === undefined) continue // sin gestionar
    if (disp < p.qty) problems.push({ sku: p.sku, size: p.size, pedido: p.qty, disponible: Math.max(0, disp) })
  }
  return problems
}
