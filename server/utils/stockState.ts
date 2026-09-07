import type { InvProduct, InvVariation } from '~~/shared/types/inventory'
import { stockBajoUmbral } from './inventoryCommon'
import { variationSku } from '~~/shared/utils/tallas'

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

export function computeStockState(products: InvProduct[], enabled: boolean, backend: 'mock' | 'woo'): StockState {
  const umbral = stockBajoUmbral()
  const st: StockState = {
    enabled, backend, agotados: new Set(), tallasAgotadas: new Map(), disponible: new Map(), bajo: [], agotadas: [], umbral, updated_at: new Date().toISOString(),
  }
  for (const p of products) {
    const outs: string[] = []
    for (const v of p.variations) {
      st.disponible.set(v.sku, v.manage_stock ? (v.stock_quantity ?? 0) : null)
      if (agotada(v)) {
        outs.push(tallaDe(v))
        if (p.status === 'publish') st.agotadas.push({ sku: v.sku, producto: p.name, talla: tallaDe(v) })
      }
      else if (v.manage_stock && (v.stock_quantity ?? 0) <= umbral && p.status === 'publish') {
        st.bajo.push({ sku: v.sku, producto: p.name, talla: tallaDe(v), cantidad: v.stock_quantity ?? 0 })
      }
    }
    if (outs.length) st.tallasAgotadas.set(p.sku, outs)
    if (p.variations.length && outs.length === p.variations.length) st.agotados.add(p.sku)
  }
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
