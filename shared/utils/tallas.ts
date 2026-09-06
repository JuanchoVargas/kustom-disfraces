/**
 * Tallas: orden canónico del sitio, normalización y convención de SKU de
 * variación de WooCommerce (`{codigo}-T{talla}`, verificada en vivo:
 * 001010001-T4, 001010002-P-T0, 001010001-TBebé). Puro (sin Nuxt): lo usan
 * server/utils/woo.ts, el módulo de inventario y el panel.
 */

export const SIZE_ORDER: (number | string)[] = ['Bebé', 0, 2, 4, 6, 8, 10, 12, 14, 'XS', 'S', 'M', 'L', 'XL']

/** Posición canónica de una talla (las desconocidas van al final, en orden alfabético entre sí). */
export function sizeRank(s: number | string): number {
  const i = SIZE_ORDER.findIndex(o => String(o) === String(s))
  return i === -1 ? SIZE_ORDER.length : i
}

/** "4" → 4, "Bebé" → "Bebé" (las numéricas se comparan como número, no como texto). */
export function normalizeTalla(s: string | number): number | string {
  const t = String(s).trim()
  return /^\d+$/.test(t) ? Number(t) : t
}

export function compareTallas(a: number | string, b: number | string): number {
  const d = sizeRank(a) - sizeRank(b)
  return d !== 0 ? d : String(a).localeCompare(String(b), 'es')
}

export function sortTallas<T extends number | string>(tallas: T[]): T[] {
  return [...tallas].sort(compareTallas)
}

/** SKU de variación de Woo para una talla: `{codigo}-T{talla}` (sin recortar acentos: "-TBebé"). */
export function variationSku(parentSku: string, talla: number | string): string {
  return `${parentSku}-T${String(talla).trim()}`
}

/**
 * Talla a partir de un SKU de variación. Se toma lo que sigue al ÚLTIMO "-T",
 * así los códigos provisionales con sufijo -P ("001010002-P-T0") no confunden.
 * null si el SKU no tiene el patrón.
 */
export function tallaFromSku(sku: string): number | string | null {
  const i = sku.lastIndexOf('-T')
  if (i < 0) return null
  const t = sku.slice(i + 2)
  return t ? normalizeTalla(t) : null
}

/** SKU del producto padre a partir del de la variación (null si no tiene patrón). */
export function parentSkuFromVariation(sku: string): string | null {
  const i = sku.lastIndexOf('-T')
  return i > 0 ? sku.slice(0, i) : null
}
