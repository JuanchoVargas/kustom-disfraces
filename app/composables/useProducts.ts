import type { Product, Category } from '~~/shared/types/woo'
import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import { catalogoToProducts } from '~~/shared/utils/catalogo'
import catalogoData from '~/data/catalogo.json'
import categoriesData from '~/data/categories.json'

/**
 * Fuente de datos del catálogo. El canónico es el shape ProductoCatalogo
 * (1 ítem = 1 referencia oficial; Súper y Línea Entrada separados, enlazados
 * solo por el cruce `pareja` de la PDP).
 *
 * Fase D: con DATA_SOURCE=woo el plugin app/plugins/catalogo.ts hidrata
 * useState('catalogo-remoto') desde el proxy /api/products (WooCommerce);
 * con DATA_SOURCE=local (default) se usa el catalogo.json empaquetado.
 * La firma del composable y las vistas no cambian en ningún modo.
 */

const CATALOGO_LOCAL = catalogoData as unknown as ProductoCatalogo[]

// memo por identidad de la fuente: la proyección solo se recalcula cuando
// cambia el array de origen (local <-> remoto hidratado)
let memoSource: ProductoCatalogo[] | null = null
let memoProducts: Product[] = []

export const useProducts = () => {
  const remoto = useState<ProductoCatalogo[] | null>('catalogo-remoto', () => null)
  const source = remoto.value ?? CATALOGO_LOCAL
  if (source !== memoSource) {
    memoSource = source
    memoProducts = catalogoToProducts(source)
  }
  const products = memoProducts
  const categories = categoriesData as Category[]

  // Hoy los datos llegan resueltos antes del render (JSON local o payload del
  // plugin), así que pending = false; los skeletons quedan listos para estados
  // de carga reales si el catálogo pasa a cargarse en cliente.
  const pending = ref(false)

  const featured = products.filter(p => p.featured)

  // Un producto puede vivir en varias categorías (unisex -> ninos Y ninas)
  const byCategory = (slug: string) => products.filter(p => (p.categorySlugs ?? [p.categorySlug]).includes(slug))
  // Públicos de la taxonomía oficial (la PLP navega por estos; ver useCatalogNav)
  const byPublico = (slug: string) => products.filter(p => p.publicos?.includes(slug))
  const bySlug = (slug: string) => products.find(p => p.slug === slug)
  const categoryBySlug = (slug: string) => categories.find(c => c.slug === slug)

  return { products, categories, featured, pending, byCategory, byPublico, bySlug, categoryBySlug }
}
