import type { Product, Category } from '~~/shared/types/woo'
import productsData from '~/data/products.json'
import categoriesData from '~/data/categories.json'

/**
 * Fuente de datos del catálogo. HOY lee de JSON local (mock).
 * En Fase D solo se cambia el origen (server/api -> WooCommerce);
 * la firma del composable y las vistas quedan iguales.
 */
export const useProducts = () => {
  const products = productsData as Product[]
  const categories = categoriesData as Category[]

  // Hoy los datos son síncronos (JSON), así que pending = false.
  // En Fase D, esto será el `pending` de useFetch('/api/...') y los
  // skeletons (que ya consumen este flag) pasan a ser los loading reales.
  const pending = ref(false)

  const featured = products.filter(p => p.featured)

  // Un producto puede vivir en varias categorías (unisex -> ninos Y ninas)
  const byCategory = (slug: string) => products.filter(p => (p.categorySlugs ?? [p.categorySlug]).includes(slug))
  const bySlug = (slug: string) => products.find(p => p.slug === slug)
  const categoryBySlug = (slug: string) => categories.find(c => c.slug === slug)

  return { products, categories, featured, pending, byCategory, bySlug, categoryBySlug }
}
