import type { InvListFilters, InvOpIds, InvOpResult, InvOperation, InvPage, InvProduct, InvVariation } from '~~/shared/types/inventory'
import type { InventoryStore } from './inventoryStore'
import type { WriteContext } from './inventoryCommon'
import {
  InvValidationError, applyFilters, logChanges, normalizePrice, normalizeStock, recomputeProduct, stockStatusFor, validatePricePair,
} from './inventoryCommon'
import { fetchWooVariations, loadInventory, loadProductBySku, snapshotUpsert } from './inventorySnapshot'
import { bloqueoDe } from './inventoryResolve'
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
 * llamar a Woo, con mensaje claro.
 *
 * LISTA DE PERMITIDOS (NUXT_INVENTORY_WOO_ALLOW, códigos de PRODUCTO separados por
 * coma, p. ej. "001006004-P"): con la guarda activa se puede escribir en borradores
 * + esos códigos y en nada más. Sirve para el piloto: abrir UN publicado sin abrir
 * los demás. Con ONLY_DRAFTS=false la lista no hace falta: se escribe en todo.
 */
export function wooOnlyDrafts(): boolean {
  return String(useRuntimeConfig().inventoryWooOnlyDrafts ?? 'true') !== 'false'
}
/** "001006004-P, 001001008" → ['001006004-P', '001001008'] (sin vacíos ni espacios). */
export function parseWooAllow(crudo: unknown): string[] {
  return String(crudo ?? '').split(',').map(s => s.trim()).filter(Boolean)
}
export function wooAllowList(): string[] {
  return parseWooAllow(useRuntimeConfig().inventoryWooAllow)
}
const BLOQUEADO = 'bloqueado: el adaptador woo solo escribe en BORRADORES (y en los códigos de NUXT_INVENTORY_WOO_ALLOW) mientras se validan las operaciones masivas (NUXT_INVENTORY_WOO_ONLY_DRAFTS)'
/**
 * Decisión PURA de la guarda: null = se puede escribir; texto = motivo del bloqueo.
 * La lista compara el código del PRODUCTO (SKU del padre), exacto y sin distinguir
 * mayúsculas; un SKU de variación ("…-T12") no abre nada.
 */
export function bloqueoEscrituraWoo(product: Pick<InvProduct, 'id' | 'sku' | 'status'>, cfg: { onlyDrafts: boolean, allow: string[] }): string | null {
  // Estructura rota en Woo (SKU duplicado / padre con SKU de variación): no se
  // escribe ni en borradores ni en permitidos, porque no se sabe en qué variación se escribiría.
  const roto = bloqueoDe(product)
  if (roto) return `bloqueado — ${roto}`
  if (!cfg.onlyDrafts || product.status !== 'publish') return null
  const codigo = String(product.sku ?? '').trim().toLowerCase()
  return codigo && cfg.allow.some(a => a.toLowerCase() === codigo) ? null : BLOQUEADO
}
/** La guarda con la configuración real del servidor. También la consulta probar-woo. */
export function guardDraft(product: Pick<InvProduct, 'id' | 'sku' | 'status'>): string | null {
  return bloqueoEscrituraWoo(product, { onlyDrafts: wooOnlyDrafts(), allow: wooAllowList() })
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

/**
 * Resuelve producto padre + variación.
 *
 * Con `ids` (product_id/variation_id fijados en la VISTA PREVIA) la búsqueda va por
 * id y NO por SKU: es lo que evita escribir en la variación equivocada cuando el SKU
 * está duplicado o cuando un padre lleva el SKU de su propia variación. Sin ids se
 * cae al camino antiguo por SKU, que solo debería usarse en scripts internos.
 */
async function resolve(skuTalla: string, ids?: InvOpIds): Promise<{ product: InvProduct, variation: InvVariation } | null> {
  if (ids?.product_id && ids?.variation_id) {
    const { products } = await loadInventory()
    const p = products.find(x => x.id === ids.product_id)
    const v = p?.variations.find(x => x.id === ids.variation_id)
    if (p && v) return { product: p, variation: v }
    // Los ids venían de la vista previa: si ya no casan, el catálogo cambió debajo.
    return null
  }
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

/**
 * Varias operaciones sobre la MISMA variación (p. ej. precio + stock de una sobreescritura)
 * viajan como UNA sola actualización con los cuerpos fusionados. Enviadas por separado,
 * Woo las aplicaba bien pero la respuesta de la primera se tomaba para las dos: el
 * snapshot quedaba sin el segundo cambio y el registro repetía el primero y perdía el otro.
 * Conserva el orden de llegada y el `before` de la primera.
 */
export function fusionarPorVariacion<T extends { id: number, body: Record<string, unknown> }>(updates: T[]): T[] {
  const porId = new Map<number, T>()
  for (const u of updates) {
    const prev = porId.get(u.id)
    if (prev) prev.body = { ...prev.body, ...u.body }
    else porId.set(u.id, { ...u, body: { ...u.body } })
  }
  return [...porId.values()]
}

/** Una escritura ya resuelta a cuerpo de Woo. `cuerpo` valida y puede lanzar InvValidationError. */
interface EscrituraWoo { sku: string, ids?: InvOpIds, cuerpo: () => Record<string, unknown> }

/**
 * NÚCLEO DE LA ESCRITURA POR LOTES (lo comparten bulkUpdate y restaurarStockWoo): se
 * valida cada escritura, se resuelve su variación, pasa la GUARDA, se agrupa por
 * producto padre y se envía POST /products/<padre>/variations/batch en trozos de 100.
 * Un fallo de validación o de resolución NO frena el resto: se reporta por SKU.
 */
async function escribirLoteWoo(escrituras: EscrituraWoo[], ctx: WriteContext): Promise<InvOpResult[]> {
  const results = new Map<string, InvOpResult>()
  const groups = new Map<number, { product: InvProduct, updates: { id: number, before: InvVariation, sku: string, body: Record<string, unknown> }[] }>()
  for (const e of escrituras) {
    try {
      const body = e.cuerpo()
      const r = await resolve(e.sku, e.ids)
      if (!r) { results.set(e.sku, { sku: e.sku, ok: false, error: e.ids?.variation_id ? `la variación ${e.ids.variation_id} ya no existe en el catálogo (vuelve a calcular la vista previa)` : 'SKU de variación inexistente en Woo' }); continue }
      const blocked = guardDraft(r.product)
      if (blocked) { results.set(e.sku, { sku: e.sku, ok: false, error: blocked }); continue }
      let g = groups.get(r.product.id)
      if (!g) { g = { product: r.product, updates: [] }; groups.set(r.product.id, g) }
      g.updates.push({ id: r.variation.id, before: r.variation, sku: e.sku, body })
    }
    catch (err) {
      results.set(e.sku, { sku: e.sku, ok: false, error: err instanceof InvValidationError ? err.message : String((err as Error)?.message ?? err) })
    }
  }
  for (const g of groups.values()) {
    g.updates = fusionarPorVariacion(g.updates)
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
  return escrituras.map(e => results.get(e.sku) ?? { sku: e.sku, ok: false, error: 'sin resultado' })
}

/** Estado de stock de una variación tal como quedó en un respaldo (scripts/respaldo-woo.mjs). */
export interface StockRespaldado { sku: string, manage_stock: boolean, stock_quantity: number | null, stock_status: 'instock' | 'outofstock' | 'onbackorder' }

/**
 * RESTAURAR STOCK desde un respaldo: deja `manage_stock`, `stock_quantity` y
 * `stock_status` como estaban. SOLO esos tres campos (nunca precio, imagen ni estado),
 * por el mismo lote y con la MISMA guarda que cualquier otra escritura. Escribe en Woo
 * sea cual sea el adaptador activo: es la marcha atrás de "aplicar overrides a Woo".
 * `stock_status` va explícito porque al quitar la gestión Woo conserva el último
 * estado: una talla que llegó a 0 seguiría "agotada" para siempre.
 */
export async function restaurarStockWoo(items: StockRespaldado[], ctx: WriteContext): Promise<InvOpResult[]> {
  return await escribirLoteWoo(items.map(it => ({
    sku: it.sku,
    cuerpo: () => {
      if (!['instock', 'outofstock', 'onbackorder'].includes(it.stock_status)) throw new InvValidationError(`stock_status inválido "${it.stock_status}"`)
      if (typeof it.manage_stock !== 'boolean') throw new InvValidationError('manage_stock debe ser true o false')
      // Sin gestión, Woo descarta la cantidad: no se envía.
      return it.manage_stock
        ? { manage_stock: true, stock_quantity: normalizeStock(it.stock_quantity), stock_status: it.stock_status }
        : { manage_stock: false, stock_status: it.stock_status }
    },
  })), ctx)
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

    async allProducts(): Promise<InvProduct[]> {
      return (await loadInventory()).products
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
      return await escribirLoteWoo(operations.map(op => ({ sku: op.sku, ids: op, cuerpo: () => bodyFor(op) })), ctx)
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
