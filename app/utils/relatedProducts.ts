import type { CartItem, Product } from '~~/shared/types/woo'

/**
 * ⚠ PROVISIONAL — lógica de sugerencias del upsell "Completa tu disfraz".
 * En Fase D se reemplaza por los related products de WooCommerce; el drawer
 * solo consume esta función, así que el cambio queda contenido aquí.
 *
 * Regla: productos de la misma categoría del ÚLTIMO ítem añadido al carrito,
 * excluyendo los que ya están en él.
 *
 * Decisión documentada: si esa categoría se agota (todo lo suyo ya está en el
 * carrito), la fila NO se oculta — se COMPLETA con productos del resto del
 * catálogo (primero los destacados), siempre excluyendo lo ya añadido.
 *
 * UX del botón: hoy cada sugerido NAVEGA a su PDP (la talla se elige allá).
 * En Fase D, con las variaciones reales de WooCommerce, se evaluará "añadir
 * directo" con un selector de talla inline en la fila del upsell.
 */
export function relatedForCart(items: CartItem[], products: Product[], max = 3): Product[] {
  if (!items.length) return []

  const inCart = new Set(items.map(i => i.slug))
  const available = products.filter(p => !inCart.has(p.slug))

  // categoría(s) del último ítem añadido
  const last = items[items.length - 1]
  const lastProduct = products.find(p => p.slug === last?.slug)
  const lastCats = new Set(lastProduct ? (lastProduct.categorySlugs ?? [lastProduct.categorySlug]) : [])

  const sameCategory = available.filter(p =>
    (p.categorySlugs ?? [p.categorySlug]).some(c => lastCats.has(c)),
  )
  const rest = available
    .filter(p => !sameCategory.includes(p))
    .sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false))

  return [...sameCategory, ...rest].slice(0, max)
}
