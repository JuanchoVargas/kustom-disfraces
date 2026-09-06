import type { InvListFilters, InvOpResult, InvOperation, InvPage, InvProduct, InvStatus, InventoryBackend } from '~~/shared/types/inventory'
import { dbConfigured } from './db'
import { createMockStore, countOverrides } from './inventoryMock'
import { createWooStore, wooOnlyDrafts } from './inventoryWoo'
import { wooWriteConfigured } from './wooWrite'
import { loadInventory, snapshotStats } from './inventorySnapshot'
import type { WriteContext } from './inventoryCommon'
import { STOCK_BAJO_UMBRAL } from './inventoryCommon'

export type { WriteContext } from './inventoryCommon'
export { STOCK_BAJO_UMBRAL, listChanges, logChanges, normalizePrice, normalizeStock, InvValidationError } from './inventoryCommon'

/**
 * CAPA DE ADAPTADOR del inventario. El panel (/admin/inventario) y el resto del
 * servidor SOLO hablan con esta interfaz; quién la implementa lo decide
 * NUXT_INVENTORY_BACKEND = mock | woo (default mock mientras no haya credencial
 * de escritura). Ambas implementaciones devuelven el shape de Woo
 * (shared/types/inventory.ts) y registran cada escritura en inventory_changes.
 *
 *   mock → server/utils/inventoryMock.ts (lee Woo/catálogo + sobreescrituras en Postgres)
 *   woo  → server/utils/inventoryWoo.ts  (escribe en la REST API, batch de 100)
 */

export interface InventoryStore {
  readonly backend: InventoryBackend
  /** true = los cambios NO llegan a Woo ni al sitio (modo simulación) */
  readonly simulation: boolean
  listProducts(filters: InvListFilters): Promise<InvPage<InvProduct>>
  /** Por SKU de producto o de variación. null si no existe. */
  getProduct(sku: string): Promise<InvProduct | null>
  updateVariationPrice(skuTalla: string, regularPrice: string | number | null, salePrice: string | number | null, ctx: WriteContext): Promise<InvOpResult>
  updateVariationStock(skuTalla: string, quantity: number, ctx: WriteContext): Promise<InvOpResult>
  bulkUpdate(operations: InvOperation[], ctx: WriteContext): Promise<InvOpResult[]>
  ping(): Promise<{ ok: boolean, detail: string }>
}

let store: InventoryStore | null = null
export function getInventoryStore(): InventoryStore {
  const backend = String(useRuntimeConfig().inventoryBackend || 'mock') === 'woo' ? 'woo' : 'mock'
  if (store && store.backend === backend) return store
  store = backend === 'woo' ? createWooStore() : createMockStore()
  return store
}

// ---------- estado para el panel ----------
export async function inventoryStatus(): Promise<InvStatus> {
  const s = getInventoryStore()
  const [ping, load, snap, overrides] = await Promise.all([s.ping(), loadInventory(), snapshotStats(), countOverrides()])
  const products = load.products
  return {
    backend: s.backend,
    simulation: s.simulation,
    ok: ping.ok,
    detail: ping.detail,
    productos: products.length,
    publicados: products.filter(p => p.status === 'publish').length,
    borradores: products.filter(p => p.status !== 'publish').length,
    variaciones: products.reduce((n, p) => n + p.variations.length, 0),
    overrides,
    snapshot_age_s: snap.newest ? Math.round((Date.now() - new Date(snap.newest).getTime()) / 1000) : null,
    origen: load.origen,
    db: dbConfigured(),
    stock_bajo_umbral: STOCK_BAJO_UMBRAL,
    woo_write: wooWriteConfigured(),
    woo_only_drafts: wooOnlyDrafts(),
  }
}
