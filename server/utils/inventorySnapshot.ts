import type { InvAttribute, InvProduct, InvVariation } from '~~/shared/types/inventory'
import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import { CATALOGO_LOCAL, sanitizeWooError, wooFetch } from './woo'
import { dbConfigured, ensureSchema, sql } from './db'
import { compareTallas, tallaFromSku, variationSku } from '~~/shared/utils/tallas'

/**
 * SNAPSHOT del inventario de WooCommerce — capa de LECTURA compartida por los
 * dos adaptadores (mock y woo).
 *
 * Leer todas las variaciones de Woo cuesta ~15 s (109 productos → 109 llamadas
 * a /products/<id>/variations), inviable en una request serverless. Por eso:
 *   1. `syncStep()` avanza por TANDAS (SYNC_CHUNK productos por llamada) y guarda
 *      cada producto en `inventory_snapshot` (JSONB, shape wc/v3 + variaciones
 *      completas). El panel llama /api/inventario/sincronizar hasta que no
 *      queden pendientes.
 *   2. `loadInventory()` lee del snapshot. Si está vacío (primera vez / BD caída)
 *      cae a catalogo.json con variaciones DERIVADAS del atributo Talla.
 *   3. `snapshotUpsert()` deja que el adaptador woo escriba de vuelta lo que
 *      acaba de cambiar (write-through) sin esperar a la próxima sincronización.
 * Sin Postgres todo vive en un Map en memoria (misma API).
 */

export const SYNC_CHUNK = 12
/** Un producto se considera fresco durante este lapso (no se vuelve a pedir a Woo). */
const FRESH_MS = 10 * 60 * 1000

// ---------- shape crudo de Woo (solo lo que usamos) ----------
export interface WooProductRaw {
  id: number
  sku: string
  name: string
  slug?: string
  type: string
  status: string
  price: string
  regular_price: string
  sale_price: string
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: string
  featured?: boolean
  date_modified?: string
  attributes?: InvAttribute[]
  variations?: number[]
  images?: { id: number, src: string, name?: string, alt?: string }[]
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

// ---------- catálogo local (taxonomía web) ----------
const localBySku = new Map<string, ProductoCatalogo>(CATALOGO_LOCAL.map(p => [p.codigo, p]))

function kustomBlock(sku: string): InvProduct['kustom'] {
  const l = localBySku.get(sku)
  if (!l) return { grupo: null, publicos: [], slug: null, imagen: null, disponibleWeb: false, soloWoo: true }
  return {
    grupo: l.grupo,
    publicos: l.publicos,
    slug: l.slug ?? null,
    imagen: l.imagenes[0] ?? null,
    disponibleWeb: l.disponibleWeb === true,
    soloWoo: false,
  }
}

const asStockStatus = (s: string): InvVariation['stock_status'] =>
  s === 'outofstock' || s === 'onbackorder' ? s : 'instock'

function tallaOptions(attributes: InvAttribute[] | undefined): string[] {
  const a = attributes?.find(x => x.name === 'Talla' || x.slug === 'pa_talla')
  return a?.options ?? []
}

/** Variaciones DERIVADAS del atributo Talla (cuando aún no se han leído de Woo). id 0. */
function derivedVariations(sku: string, price: string, regular: string, sale: string, tallas: string[]): InvVariation[] {
  return tallas.map(t => ({
    id: 0,
    sku: variationSku(sku, t),
    status: 'publish' as const,
    price,
    regular_price: regular || price,
    sale_price: sale,
    manage_stock: false,
    stock_quantity: null,
    stock_status: 'instock' as const,
    attributes: [{ name: 'Talla', slug: 'pa_talla', option: t }],
  }))
}

function sortVariations(vs: InvVariation[]): InvVariation[] {
  return [...vs].sort((a, b) => compareTallas(tallaFromSku(a.sku) ?? a.sku, tallaFromSku(b.sku) ?? b.sku))
}

export function fromWoo(raw: WooProductRaw, variations: WooVariationRaw[] | null, fetchedAt: string): InvProduct {
  const tallas = tallaOptions(raw.attributes)
  const vs: InvVariation[] = variations
    ? variations.map(v => ({
        id: v.id,
        // Woo puede dejar el sku de la variación vacío: se reconstruye por la convención.
        sku: v.sku || variationSku(raw.sku, v.attributes?.find(a => a.name === 'Talla')?.option ?? ''),
        status: v.status === 'private' ? 'private' : 'publish',
        price: v.price ?? '',
        regular_price: v.regular_price ?? '',
        sale_price: v.sale_price ?? '',
        manage_stock: !!v.manage_stock,
        stock_quantity: v.stock_quantity ?? null,
        stock_status: asStockStatus(v.stock_status),
        attributes: (v.attributes ?? []).map(a => ({ id: a.id, name: a.name, slug: a.slug, option: a.option })),
        date_modified: v.date_modified,
        image: v.image?.id ? { id: v.image.id, src: v.image.src, name: v.image.name, alt: v.image.alt } : null,
      }))
    : derivedVariations(raw.sku, raw.price ?? '', raw.regular_price ?? '', raw.sale_price ?? '', tallas)
  return {
    id: raw.id,
    sku: raw.sku,
    name: raw.name,
    slug: raw.slug,
    type: raw.type === 'variable' ? 'variable' : 'simple',
    status: (['publish', 'draft', 'pending', 'private'].includes(raw.status) ? raw.status : 'draft') as InvProduct['status'],
    price: raw.price ?? '',
    regular_price: raw.regular_price ?? '',
    sale_price: raw.sale_price ?? '',
    manage_stock: !!raw.manage_stock,
    stock_quantity: raw.stock_quantity ?? null,
    stock_status: asStockStatus(raw.stock_status),
    featured: !!raw.featured,
    attributes: raw.attributes ?? [],
    date_modified: raw.date_modified,
    images: (raw.images ?? []).map(i => ({ id: i.id, src: i.src, name: i.name, alt: i.alt })),
    variations: sortVariations(vs),
    kustom: kustomBlock(raw.sku),
    origen: 'woo',
    fetched_at: fetchedAt,
  }
}

/** Producto construido SOLO desde catalogo.json (Woo inaccesible y snapshot vacío). */
function fromCatalogo(l: ProductoCatalogo, fetchedAt: string): InvProduct {
  const price = l.precio != null ? String(l.precio) : ''
  const tallas = l.tallas.map(String)
  return {
    id: -(l.idWeb ?? 0) || -Math.abs(hash(l.codigo)),
    sku: l.codigo,
    name: l.nombre,
    slug: l.slug,
    type: 'variable',
    status: l.disponibleWeb ? 'publish' : 'draft',
    price,
    regular_price: price,
    sale_price: '',
    manage_stock: false,
    stock_quantity: null,
    stock_status: 'instock',
    featured: !!l.destacado,
    attributes: [{ name: 'Talla', slug: 'pa_talla', variation: true, options: tallas }],
    images: [],
    variations: sortVariations(derivedVariations(l.codigo, price, price, '', tallas)),
    kustom: kustomBlock(l.codigo),
    origen: 'catalogo',
    fetched_at: fetchedAt,
  }
}
function hash(s: string): number {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1_000_003
  return h + 1
}

// ---------- lectura de Woo (llave de solo lectura) ----------
let listCache: { at: number, items: WooProductRaw[] } | null = null
const LIST_TTL_MS = 2 * 60 * 1000

/** Lista completa de productos (cualquier estado), cacheada 2 min en memoria. */
export async function fetchWooProductList(force = false): Promise<WooProductRaw[]> {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.items
  const all: WooProductRaw[] = []
  for (let page = 1; page <= 10; page++) {
    const batch = await wooFetch<WooProductRaw[]>('/products', { per_page: 100, page, status: 'any' })
    all.push(...batch)
    if (batch.length < 100) break
  }
  listCache = { at: Date.now(), items: all }
  return all
}

export async function fetchWooVariations(productId: number): Promise<WooVariationRaw[]> {
  const out: WooVariationRaw[] = []
  for (let page = 1; page <= 5; page++) {
    const batch = await wooFetch<WooVariationRaw[]>(`/products/${productId}/variations`, { per_page: 100, page })
    out.push(...batch)
    if (batch.length < 100) break
  }
  return out
}

// ---------- almacenamiento del snapshot (Postgres o memoria) ----------
const memory = new Map<string, { product: InvProduct, fetched_at: string }>()

async function dbReady(): Promise<boolean> {
  if (!dbConfigured()) return false
  try {
    await ensureSchema()
    return true
  }
  catch (err) {
    console.error('[inventario] BD no disponible — snapshot en memoria:', String((err as Error)?.message ?? err))
    return false
  }
}

export async function snapshotAll(): Promise<InvProduct[]> {
  if (await dbReady()) {
    const rows = await sql().query(`SELECT product FROM inventory_snapshot ORDER BY sku`) as { product: InvProduct }[]
    if (rows.length) return rows.map(r => r.product)
  }
  return [...memory.values()].map(m => m.product).sort((a, b) => a.sku.localeCompare(b.sku))
}

export async function snapshotGet(sku: string): Promise<InvProduct | null> {
  if (await dbReady()) {
    const rows = await sql().query(`SELECT product FROM inventory_snapshot WHERE sku = $1`, [sku]) as { product: InvProduct }[]
    if (rows[0]) return rows[0].product
  }
  return memory.get(sku)?.product ?? null
}

export async function snapshotUpsert(products: InvProduct[]): Promise<void> {
  if (!products.length) return
  for (const p of products) memory.set(p.sku, { product: p, fetched_at: p.fetched_at })
  if (!await dbReady()) return
  const q = sql()
  for (const p of products) {
    await q.query(
      `INSERT INTO inventory_snapshot (sku, product, fetched_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sku) DO UPDATE SET product = EXCLUDED.product, fetched_at = EXCLUDED.fetched_at`,
      [p.sku, JSON.stringify(p), p.fetched_at],
    )
  }
}

export async function snapshotDelete(skus: string[]): Promise<void> {
  for (const s of skus) memory.delete(s)
  if (!skus.length || !await dbReady()) return
  await sql().query(`DELETE FROM inventory_snapshot WHERE sku = ANY($1::text[])`, [skus])
}

export async function snapshotStats(): Promise<{ count: number, newest: string | null, oldest: string | null }> {
  if (await dbReady()) {
    const rows = await sql().query(`SELECT count(*)::int AS c, max(fetched_at) AS n, min(fetched_at) AS o FROM inventory_snapshot`) as any[]
    const r = rows[0]
    if (r && r.c > 0) return { count: r.c, newest: new Date(r.n).toISOString(), oldest: new Date(r.o).toISOString() }
  }
  const dates = [...memory.values()].map(m => m.fetched_at).sort()
  return { count: memory.size, newest: dates.at(-1) ?? null, oldest: dates[0] ?? null }
}

// ---------- sincronización por tandas ----------
export interface SyncResult {
  total: number
  /** productos que aún no tienen variaciones frescas */
  pendientes: number
  procesados: number
  /** SKUs que Woo tiene y ya no existen (se retiran del snapshot) */
  retirados: number
  error?: string
}

/**
 * Un paso de sincronización: (1) lista de productos de Woo, (2) upsert directo
 * de los que no requieren variaciones, (3) hasta SYNC_CHUNK productos variables
 * cuyas variaciones estén viejas o falten. Devuelve cuántos quedan.
 */
export async function syncStep(force = false): Promise<SyncResult> {
  let list: WooProductRaw[]
  try {
    list = await fetchWooProductList(force)
  }
  catch (err) {
    return { total: 0, pendientes: 0, procesados: 0, retirados: 0, error: sanitizeWooError(err) }
  }
  const withSku = list.filter(p => p.sku)
  const now = new Date().toISOString()
  const existing = new Map((await snapshotAll()).map(p => [p.sku, p]))

  // Productos que Woo ya no tiene → fuera del snapshot.
  const wooSkus = new Set(withSku.map(p => p.sku))
  const gone = [...existing.keys()].filter(s => !wooSkus.has(s))
  await snapshotDelete(gone)

  const needs: WooProductRaw[] = []
  const direct: InvProduct[] = []
  for (const raw of withSku) {
    const prev = existing.get(raw.sku)
    const isVariable = raw.type === 'variable' && (raw.variations?.length ?? tallaOptions(raw.attributes).length) > 0
    if (!isVariable) {
      direct.push(fromWoo(raw, [], now))
      continue
    }
    const fresh = prev && prev.origen === 'woo' && prev.variations.every(v => v.id > 0)
      && Date.now() - new Date(prev.fetched_at).getTime() < FRESH_MS
      && (!raw.date_modified || !prev.date_modified || raw.date_modified <= prev.date_modified)
    if (force || !fresh) needs.push(raw)
    else if (prev && (prev.name !== raw.name || prev.status !== raw.status || prev.price !== raw.price)) {
      // Cambió algo del padre sin tocar variaciones: refrescar solo cabecera.
      direct.push({ ...fromWoo(raw, null, prev.fetched_at), variations: prev.variations })
    }
  }
  await snapshotUpsert(direct)

  const chunk = needs.slice(0, SYNC_CHUNK)
  const CONCURRENCY = 4
  const done: InvProduct[] = []
  for (let i = 0; i < chunk.length; i += CONCURRENCY) {
    await Promise.all(chunk.slice(i, i + CONCURRENCY).map(async (raw) => {
      try {
        const vars = await fetchWooVariations(raw.id)
        done.push(fromWoo(raw, vars, now))
      }
      catch (err) {
        console.error(`[inventario] variaciones de ${raw.sku} no leídas:`, sanitizeWooError(err))
        // Se guarda con variaciones derivadas (id 0) para que el panel las muestre; se reintenta luego.
        if (!existing.get(raw.sku)) done.push(fromWoo(raw, null, new Date(0).toISOString()))
      }
    }))
  }
  await snapshotUpsert(done)
  return { total: withSku.length, pendientes: needs.length - chunk.length, procesados: direct.length + done.length, retirados: gone.length }
}

// ---------- carga para los adaptadores ----------
export interface InventoryLoad {
  products: InvProduct[]
  origen: 'woo' | 'catalogo' | 'vacio'
  fetched_at: string | null
}

/** Inventario completo: snapshot si existe; si no, catalogo.json derivado. */
export async function loadInventory(): Promise<InventoryLoad> {
  const snap = await snapshotAll()
  if (snap.length) {
    const newest = snap.map(p => p.fetched_at).sort().at(-1) ?? null
    return { products: snap, origen: 'woo', fetched_at: newest }
  }
  const now = new Date().toISOString()
  return { products: CATALOGO_LOCAL.map(l => fromCatalogo(l, now)), origen: 'catalogo', fetched_at: null }
}

/** Un producto por SKU de padre O de variación. */
export async function loadProductBySku(sku: string): Promise<InvProduct | null> {
  const { products } = await loadInventory()
  const direct = products.find(p => p.sku === sku)
  if (direct) return direct
  return products.find(p => p.variations.some(v => v.sku === sku)) ?? null
}
