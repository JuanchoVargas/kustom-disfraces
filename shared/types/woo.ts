/**
 * Tipos de dominio Kustom (mapeables a la API REST de WooCommerce en Fase D).
 * Auto-importados por Nuxt 4 (shared/types) en app/ y server/.
 */

export type BadgeVariant = 'new' | 'sale' | 'promo' | 'soldout' | 'neutral'

export interface ProductBadge {
  variant: BadgeVariant
  label: string
}

/** Enlace cruzado entre un producto Súper y su versión Línea Entrada */
export interface ProductPareja {
  slug: string
  name: string
  /** Qué es el producto ENLAZADO: 'super' (premium) o 'economico' (Línea Entrada) */
  tipo: 'super' | 'economico'
}

export interface Product {
  id: number
  name: string
  slug: string
  /** Código de producto del catálogo (sufijo -P = provisional, pendiente cliente) */
  code?: string
  /** Precio actual en COP (entero, sin separadores) — ⚠ hoy PROVISIONAL, ver README */
  price: number
  /** Precio anterior tachado, si está en oferta */
  regularPrice?: number
  /** Tallas disponibles (de la gama por defecto) */
  sizes: (number | string)[]
  /** Tallas agotadas (subconjunto de sizes) */
  soldOutSizes?: (number | string)[]
  /** Qué incluye el disfraz (del catálogo 2026) */
  includes?: string[]
  badges?: ProductBadge[]
  /** URLs de imagen (vacío -> placeholder hasta Fase D) */
  images: string[]
  /** Slug de la categoría principal a la que pertenece */
  categorySlug: string
  /** Todas las categorías (los unisex aparecen en ninos Y ninas) */
  categorySlugs?: string[]
  /** Aparece en "Los más buscados" */
  featured?: boolean
  /** Descripción corta para la PDP */
  description?: string
  /** Temporada (filtro de la PLP): "Halloween", "Día de Muertos", "Todo el año"… */
  season?: string
  /** Públicos de la taxonomía oficial (bebes|ninos|ninas|damas|caballeros) — navbar/PLP */
  publicos?: string[]
  /** Subcategorías de navegación del producto */
  subcategoriasNav?: string[]
  /** Su par Súper/Línea Entrada, si existe — enlace cruzado en la PDP */
  pareja?: ProductPareja
}

export interface Category {
  id: number
  name: string
  slug: string
  images?: string[]
}

export interface CartItem {
  productId: number
  name: string
  slug: string
  /** Precio unitario en COP */
  price: number
  image?: string
  size: number | string
  gama?: string
  quantity: number
}
