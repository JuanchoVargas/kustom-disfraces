import type { InvProduct, InvVariation } from '~~/shared/types/inventory'
import { loadInventory } from './inventorySnapshot'
import { variationSku } from '~~/shared/utils/tallas'

/**
 * RESOLUCIÓN SKU → (product_id, variation_id). Única puerta para convertir un SKU
 * de talla en los ids REALES de WooCommerce, y la usan los dos caminos:
 *
 *   - pedidos  (wooOrders): para que `line_items` lleve variation_id y Woo descuente.
 *   - panel    (inventoryWoo): la escritura va SIEMPRE por variation_id explícito,
 *              resuelto en la vista previa y transportado hasta la escritura.
 *
 * Se niega a adivinar. `loadProductBySku` buscaba PRIMERO por SKU de padre y luego
 * entre las variaciones, así que:
 *   - "005001001-T12" (producto 747) caía en el padre y luego devolvía la PRIMERA de
 *     sus 8 variaciones con ese mismo SKU — la que no tiene talla (vid 760).
 *   - "001002001" resolvía al padre 22 antes que a su variación 729, que lleva el
 *     SKU de su propio padre.
 * Aquí eso es AMBIGUO y se rechaza con motivo, en vez de escribir en la variación
 * equivocada.
 */

export interface VariacionResuelta {
  ok: boolean
  sku: string
  product_id?: number
  variation_id?: number
  producto?: string
  status?: InvProduct['status']
  /** Por qué no se pudo resolver (texto para el registro y la alerta). */
  motivo?: string
}

/**
 * PRODUCTOS BLOQUEADOS PARA ESCRITURA. Estructura rota en Woo: escribir ahí es
 * escribir en la variación equivocada. Se levanta cuando el catálogo se corrija.
 *
 *  747 "Vaquerito Woody": 8 variaciones con el MISMO SKU (005001001-T12), tallas 4
 *      y 6 repetidas, una variación sin talla, y el padre con un SKU de talla.
 *  22  "Spider-Man Negro Línea Entrada": su variación 729 lleva el SKU del padre
 *      (001002001), así que ese SKU es ambiguo entre padre y variación.
 */
export const PRODUCTOS_BLOQUEADOS: Record<number, string> = {
  747: 'Vaquerito Woody: 8 variaciones comparten el SKU 005001001-T12 (tallas 4 y 6 repetidas, una sin talla, y el padre con SKU de talla). Corregir en Woo antes de escribir.',
  22: 'Spider-Man Negro Línea Entrada: la variación 729 lleva el SKU de su propio padre (001002001). Corregir el SKU de la variación antes de escribir.',
}
export const SKUS_BLOQUEADOS: Record<string, string> = {
  '005001001-T12': PRODUCTOS_BLOQUEADOS[747]!,
  '001002001': PRODUCTOS_BLOQUEADOS[22]!,
}

/** Motivo de bloqueo de un producto, o null. */
export function bloqueoDe(p: Pick<InvProduct, 'id' | 'sku'>): string | null {
  return PRODUCTOS_BLOQUEADOS[p.id] ?? SKUS_BLOQUEADOS[p.sku] ?? null
}

/**
 * Busca la variación por su SKU EXACTO, sin preferir al padre. Devuelve todas las
 * coincidencias para poder detectar la ambigüedad en vez de taparla.
 */
function buscarVariaciones(products: InvProduct[], skuVariacion: string): { p: InvProduct, v: InvVariation }[] {
  const hits: { p: InvProduct, v: InvVariation }[] = []
  for (const p of products) {
    for (const v of p.variations) if (v.sku === skuVariacion) hits.push({ p, v })
  }
  return hits
}

/** Resuelve un SKU de VARIACIÓN ya construido (p. ej. "001001013-T4"). */
export async function resolverSkuVariacion(skuVariacion: string): Promise<VariacionResuelta> {
  const base: VariacionResuelta = { ok: false, sku: skuVariacion }
  if (!skuVariacion) return { ...base, motivo: 'SKU vacío' }

  const bloqueo = SKUS_BLOQUEADOS[skuVariacion]
  if (bloqueo) return { ...base, motivo: `bloqueado — ${bloqueo}` }

  let products: InvProduct[]
  try {
    products = (await loadInventory()).products
  }
  catch (err) {
    return { ...base, motivo: `no se pudo leer el inventario: ${String((err as Error)?.message ?? err)}` }
  }

  const hits = buscarVariaciones(products, skuVariacion)
  if (!hits.length) return { ...base, motivo: 'no existe ninguna variación con ese SKU' }
  if (hits.length > 1) {
    const donde = hits.map(h => `#${h.p.id} ${h.p.name} (vid ${h.v.id})`).join(', ')
    return { ...base, motivo: `SKU duplicado en ${hits.length} variaciones: ${donde}` }
  }
  const { p, v } = hits[0]!
  const bloqueoProd = bloqueoDe(p)
  if (bloqueoProd) return { ...base, producto: p.name, product_id: p.id, motivo: `bloqueado — ${bloqueoProd}` }

  // El padre lleva el MISMO SKU que la variación: ambiguo, no se escribe a ciegas.
  if (p.sku === skuVariacion) {
    return { ...base, producto: p.name, product_id: p.id, motivo: `ambiguo: el producto #${p.id} lleva el mismo SKU que su variación` }
  }
  if (!(p.id > 0)) return { ...base, producto: p.name, motivo: 'el producto no tiene id de Woo en el snapshot (sincroniza)' }
  if (!(v.id > 0)) return { ...base, producto: p.name, product_id: p.id, motivo: 'la variación no tiene id de Woo en el snapshot (sincroniza)' }

  return { ok: true, sku: skuVariacion, product_id: p.id, variation_id: v.id, producto: p.name, status: p.status }
}

/**
 * Resuelve desde el SKU del PRODUCTO + la talla, que es lo que tiene el checkout.
 * Sin talla no hay variación que resolver: se devuelve el motivo, nunca un id a ojo.
 */
export async function resolverProductoTalla(skuProducto: string, talla: string | number | null | undefined): Promise<VariacionResuelta> {
  const t = talla === null || talla === undefined ? '' : String(talla).trim()
  if (!skuProducto) return { ok: false, sku: '', motivo: 'SKU de producto vacío' }
  if (!t) return { ok: false, sku: skuProducto, motivo: 'la línea no trae talla' }
  return await resolverSkuVariacion(variationSku(skuProducto, t))
}

/**
 * Talla a partir del título que se le mandó a Mercado Pago. El título se compone en
 * el checkout como "Nombre (Talla 4, Súper Acolchado)": la gama va DESPUÉS de una
 * coma, así que se corta ahí. La expresión anterior (`\(Talla\s*(.+?)\)`) se tragaba
 * la gama entera y devolvía "4, Súper Acolchado".
 */
export function tallaDesdeTitulo(titulo: string): string | null {
  const m = String(titulo ?? '').match(/\(\s*Talla\s*([^,)]+)/i)
  const t = m?.[1]?.trim()
  return t || null
}
