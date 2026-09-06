/**
 * MÓDULO DE INVENTARIO — tipos compartidos (panel /admin/inventario + servidor).
 *
 * La forma de producto y variación es LA DE WOOCOMMERCE (mismos nombres y
 * tipos que devuelve la REST API wc/v3: precios como texto, `stock_quantity`
 * null cuando no se gestiona, `attributes[{name:'Talla', option}]`…). Así el
 * cambio de adaptador mock → woo no exige tocar la interfaz. Única desviación
 * documentada: `variations` lleva las variaciones COMPLETAS (Woo devuelve solo
 * sus ids); y `kustom` es un bloque ADITIVO con la taxonomía web local.
 */

export type InvStockStatus = 'instock' | 'outofstock' | 'onbackorder'
export type InvProductStatus = 'publish' | 'draft' | 'pending' | 'private'
export type InventoryBackend = 'mock' | 'woo'

export interface InvAttributeOption {
  id?: number
  name: string
  slug?: string
  option: string
}

export interface InvAttribute {
  id?: number
  name: string
  slug?: string
  position?: number
  visible?: boolean
  variation?: boolean
  options: string[]
}

/** Variación (una talla) — shape wc/v3 products/<id>/variations */
export interface InvVariation {
  /** id de Woo; 0 cuando la variación se derivó del atributo Talla (aún sin leer de Woo) */
  id: number
  /** `{codigo}-T{talla}` (verificado en vivo: 001010001-T4, 001010001-TBebé) */
  sku: string
  status: 'publish' | 'private'
  price: string
  regular_price: string
  sale_price: string
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: InvStockStatus
  attributes: InvAttributeOption[]
  date_modified?: string
}

/** Producto padre — shape wc/v3 products (+ variations completas + kustom) */
export interface InvProduct {
  id: number
  sku: string
  name: string
  slug?: string
  type: 'simple' | 'variable'
  status: InvProductStatus
  price: string
  regular_price: string
  sale_price: string
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: InvStockStatus
  featured?: boolean
  attributes: InvAttribute[]
  date_modified?: string
  variations: InvVariation[]
  /** Taxonomía web local (catalogo.json). No existe en Woo: bloque aditivo. */
  kustom: {
    grupo: string | null
    publicos: string[]
    slug: string | null
    imagen: string | null
    disponibleWeb: boolean
    /** true si el producto NO existe en catalogo.json (solo en Woo) */
    soloWoo: boolean
  }
  /** De dónde salió este registro y cuándo se leyó */
  origen: 'woo' | 'catalogo'
  fetched_at: string
}

export type InvStockFilter = 'any' | 'bajo' | 'agotado' | 'sin_gestion'
export type InvOrderBy = 'name' | 'sku' | 'price' | 'stock' | 'modified'

export interface InvListFilters {
  q?: string
  status?: InvProductStatus | 'any'
  grupo?: string
  publico?: string
  stock?: InvStockFilter
  orderby?: InvOrderBy
  order?: 'asc' | 'desc'
  page?: number
  per_page?: number
}

export interface InvPage<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

/** Operación de escritura sobre UNA variación (por su SKU de talla). */
export type InvOperation =
  | { op: 'price', sku: string, regular_price: string | number | null, sale_price: string | number | null }
  | { op: 'stock', sku: string, stock_quantity: number, manage_stock?: boolean }

/** Origen de una escritura (queda en el registro de cambios). */
export type InvChangeOrigin = 'panel' | 'masivo' | 'importacion' | 'script' | 'checkout' | 'prueba'

export interface InvOpResult {
  sku: string
  ok: boolean
  error?: string
  before?: Partial<InvVariation>
  after?: Partial<InvVariation>
}

export interface InvChange {
  id: number
  backend: InventoryBackend
  sku: string
  campo: string
  anterior: string | null
  nuevo: string | null
  origen: InvChangeOrigin
  autor: string | null
  created_at: string
}

export interface InvStatus {
  backend: InventoryBackend
  /** true en mock: los cambios NO se reflejan en el sitio ni en Woo */
  simulation: boolean
  ok: boolean
  detail: string
  productos: number
  publicados: number
  borradores: number
  variaciones: number
  overrides: number
  /** Antigüedad del snapshot de Woo (segundos), null si no hay snapshot */
  snapshot_age_s: number | null
  origen: 'woo' | 'catalogo' | 'vacio'
  db: boolean
  stock_bajo_umbral: number
}
