import type { InvListFilters, InvOpResult, InvOperation, InvPage, InvProduct, InvVariation } from '~~/shared/types/inventory'
import type { InventoryStore } from './inventoryStore'
import type { WriteContext } from './inventoryCommon'
import {
  InvValidationError, applyFilters, logChanges, normalizePrice, normalizeStock, recomputeProduct, stockStatusFor, validatePricePair,
} from './inventoryCommon'
import { fetchWooVariations, loadInventory, loadProductBySku, snapshotUpsert } from './inventorySnapshot'
import { sanitizeWooError, wooFetch } from './woo'
import { wooWriteCredentials, wooWriteFetch } from './wooWrite'

/**
 * ADAPTADOR WOO — escribe de verdad en WooCommerce (REST API wc/v3) con la llave
 * de ESCRITURA ("Checkout Orders v2": las llaves de Woo no distinguen recursos,
 * la misma sirve para órdenes y productos). Lecturas: del snapshot compartido.
 * Escrituras: PUT por variación o POST .../variations/batch (100 por llamada,
 * agrupadas por producto padre porque el endpoint batch es por padre), y
 * write-through al snapshot para que el panel refleje el cambio al instante.
 *
 * Escrito ANTES de tener credencial probada: scripts/test-woo-escritura.mjs lo
 * valida (cambia y revierte un precio en un producto EN BORRADOR).
 */

export const WOO_BATCH = 100

// Credenciales y cliente de escritura: server/utils/wooWrite.ts (compartido con
// el checkout). Aquí solo alias para el resto del archivo.
export { wooWriteConfigured } from './wooWrite'
const wooWrite = wooWriteFetch

/**
 * GUARDA DE VALIDACIÓN (NUXT_INVENTORY_WOO_ONLY_DRAFTS, default true): mientras
 * no se validen las operaciones masivas, el adaptador woo SOLO escribe en
 * productos EN BORRADOR. Una escritura a un publicado se rechaza ANTES de
 * llamar a Woo, con mensaje claro. Los 66 publicados no se tocan.
 */
export function wooOnlyDrafts(): boolean {
  return String(useRuntimeConfig().inventoryWooOnlyDrafts ?? 'true') !== 'false'
}
const BLOQUEADO = 'bloqueado: el adaptador woo solo escribe en BORRADORES mientras se validan las operaciones masivas (NUXT_INVENTORY_WOO_ONLY_DRAFTS)'
function guardDraft(product: InvProduct): string | null {
  return wooOnlyDrafts() && product.status === 'publish' ? BLOQUEADO : null
}

interface WooVariationRaw {
  id: number
  sku: string
  status: string
  price: string
  regular_price: string
  sale_price: string
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: string
  date_modified?: string
  attributes?: { id?: number, name: string, slug?: string, option: string }[]
  image?: { id: number, src: string, name?: string, alt?: string } | null
}

const fromRaw = (v: WooVariationRaw, fallbackSku: string): InvVariation => ({
  id: v.id,
  sku: v.sku || fallbackSku,
  status: v.status === 'private' ? 'private' : 'publish',
  price: v.price ?? '',
  regular_price: v.regular_price ?? '',
  sale_price: v.sale_price ?? '',
  manage_stock: !!v.manage_stock,
  stock_quantity: v.stock_quantity ?? null,
  stock_status: v.stock_status === 'outofstock' || v.stock_status === 'onbackorder' ? v.stock_status : 'instock',
  attributes: (v.attributes ?? []).map(a => ({ id: a.id, name: a.name, slug: a.slug, option: a.option })),
  date_modified: v.date_modified,
  image: v.image?.id ? { id: v.image.id, src: v.image.src, name: v.image.name, alt: v.image.alt } : null,
})

const pick = (v: InvVariation): Partial<InvVariation> => ({
  regular_price: v.regular_price, sale_price: v.sale_price, price: v.price, manage_stock: v.manage_stock, stock_quantity: v.stock_quantity, stock_status: v.stock_status,
})

/** Resuelve producto padre + variación con ids REALES (leyendo Woo si el snapshot solo tiene derivadas). */
async function resolve(skuTalla: string): Promise<{ product: InvProduct, variation: InvVariation } | null> {
  let product = await loadProductBySku(skuTalla)
  if (!product) return null
  let variation = product.variations.find(v => v.sku === skuTalla)
  if (!variation) return null
  if (variation.id <= 0 || product.id <= 0) {
    // ids desconocidos → leer de Woo por SKU del padre y refrescar el snapshot
    const parents = await wooFetch<{ id: number }[]>('/products', { sku: product.sku })
    const parentId = parents[0]?.id
    if (!parentId) return null
    const raw = await fetchWooVariations(parentId)
    const vars = raw.map(v => fromRaw(v as WooVariationRaw, v.sku))
    product = recomputeProduct({ ...product, id: parentId, origen: 'woo', fetched_at: new Date().toISOString(), variations: vars })
    await snapshotUpsert([product])
    variation = product.variations.find(v => v.sku === skuTalla)
    if (!variation) return null
  }
  return { product, variation }
}

/** Cuerpo de escritura Woo para una operación ya validada. */
function bodyFor(op: InvOperation): Record<string, unknown> {
  if (op.op === 'price') {
    const regular = normalizePrice(op.regular_price, 'regular_price')
    const sale = normalizePrice(op.sale_price, 'sale_price')
    validatePricePair(regular, sale)
    return { regular_price: regular, sale_price: sale }
  }
  const qty = normalizeStock(op.stock_quantity)
  return { manage_stock: op.manage_stock ?? true, stock_quantity: qty }
}

async function writeThrough(product: InvProduct, updated: InvVariation[]): Promise<InvProduct> {
  const bySku = new Map(updated.map(v => [v.sku, v]))
  const next = recomputeProduct({
    ...product,
    variations: product.variations.map(v => bySku.get(v.sku) ?? v),
    fetched_at: new Date().toISOString(),
  })
  await snapshotUpsert([next])
  return next
}

export function createWooStore(): InventoryStore {
  async function single(op: InvOperation, ctx: WriteContext): Promise<InvOpResult> {
    try {
      const body = bodyFor(op)
      const r = await resolve(op.sku)
      if (!r) return { sku: op.sku, ok: false, error: 'SKU de variación inexistente en Woo' }
      const blocked = guardDraft(r.product)
      if (blocked) return { sku: op.sku, ok: false, error: blocked }
      // ESCRITURA PRIMERO A WOO; el snapshot se actualiza solo si Woo aceptó.
      const raw = await wooWrite<WooVariationRaw>(`/products/${r.product.id}/variations/${r.variation.id}`, { method: 'PUT', body })
      const after = fromRaw(raw, op.sku)
      after.stock_status = stockStatusFor(after)
      await writeThrough(r.product, [after])
      await logChanges('woo', op.sku, pick(r.variation), pick(after), ctx)
      return { sku: op.sku, ok: true, before: pick(r.variation), after: pick(after) }
    }
    catch (err) {
      const msg = err instanceof InvValidationError ? err.message : `Woo: ${sanitizeWooError(err)}`
      return { sku: op.sku, ok: false, error: msg }
    }
  }

  return {
    backend: 'woo',
    simulation: false,

    async listProducts(filters: InvListFilters): Promise<InvPage<InvProduct>> {
      const { products } = await loadInventory()
      return applyFilters(products, filters)
    },

    getProduct(sku: string) {
      return loadProductBySku(sku)
    },

    updateVariationPrice(skuTalla, regularPrice, salePrice, ctx) {
      return single({ op: 'price', sku: skuTalla, regular_price: regularPrice, sale_price: salePrice }, ctx)
    },

    updateVariationStock(skuTalla, quantity, ctx) {
      return single({ op: 'stock', sku: skuTalla, stock_quantity: quantity, manage_stock: true }, ctx)
    },

    /**
     * Batch: se valida cada operación, se agrupa por producto padre y se envía
     * POST /products/<padre>/variations/batch en trozos de 100. Un fallo de
     * validación o de resolución NO frena el resto: se reporta por SKU.
     */
    async bulkUpdate(operations, ctx) {
      const results = new Map<string, InvOpResult>()
      const groups = new Map<number, { product: InvProduct, updates: { id: number, before: InvVariation, sku: string, body: Record<string, unknown> }[] }>()
      for (const op of operations) {
        try {
          const body = bodyFor(op)
          const r = await resolve(op.sku)
          if (!r) { results.set(op.sku, { sku: op.sku, ok: false, error: 'SKU de variación inexistente en Woo' }); continue }
          const blocked = guardDraft(r.product)
          if (blocked) { results.set(op.sku, { sku: op.sku, ok: false, error: blocked }); continue }
          let g = groups.get(r.product.id)
          if (!g) { g = { product: r.product, updates: [] }; groups.set(r.product.id, g) }
          g.updates.push({ id: r.variation.id, before: r.variation, sku: op.sku, body })
        }
        catch (err) {
          results.set(op.sku, { sku: op.sku, ok: false, error: err instanceof InvValidationError ? err.message : String((err as Error)?.message ?? err) })
        }
      }
      for (const g of groups.values()) {
        for (let i = 0; i < g.updates.length; i += WOO_BATCH) {
          const slice = g.updates.slice(i, i + WOO_BATCH)
          try {
            const res = await wooWrite<{ update?: (WooVariationRaw & { error?: { message?: string } })[] }>(
              `/products/${g.product.id}/variations/batch`,
              { method: 'POST', body: { update: slice.map(u => ({ id: u.id, ...u.body })) } },
            )
            const updated: InvVariation[] = []
            for (const u of slice) {
              const raw = res.update?.find(x => x.id === u.id)
              if (!raw || raw.error) { results.set(u.sku, { sku: u.sku, ok: false, error: `Woo: ${raw?.error?.message ?? 'sin respuesta para la variación'}` }); continue }
              const after = fromRaw(raw, u.sku)
              after.stock_status = stockStatusFor(after)
              updated.push(after)
              await logChanges('woo', u.sku, pick(u.before), pick(after), ctx)
              results.set(u.sku, { sku: u.sku, ok: true, before: pick(u.before), after: pick(after) })
            }
            if (updated.length) g.product = await writeThrough(g.product, updated)
          }
          catch (err) {
            const msg = `Woo: ${sanitizeWooError(err)}`
            for (const u of slice) results.set(u.sku, { sku: u.sku, ok: false, error: msg })
          }
        }
      }
      return operations.map(op => results.get(op.sku) ?? { sku: op.sku, ok: false, error: 'sin resultado' })
    },

    async ping() {
      const cred = wooWriteCredentials()
      if (!cred) return { ok: false, detail: 'Woo: falta la llave de escritura (NUXT_WOO_WRITE_CONSUMER_KEY/SECRET)' }
      try {
        await wooWrite<unknown[]>('/products', { query: { per_page: 1 } })
        return { ok: true, detail: `Woo: llave de escritura responde (${cred.origen === 'write' ? 'NUXT_WOO_WRITE_*' : 'respaldo NUXT_WOO_ORDERS_*'})${wooOnlyDrafts() ? ' · solo borradores' : ''}` }
      }
      catch (err) {
        return { ok: false, detail: `Woo no responde con la llave de escritura: ${sanitizeWooError(err)}` }
      }
    },
  }
}
