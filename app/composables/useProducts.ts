import type { Product, Category } from '~~/shared/types/woo'
import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import { catalogoToProducts } from '~~/shared/utils/catalogo'
import { precioEfectivo, type PromocionActiva } from '~~/shared/utils/promociones'
import type { PromoState } from '~/plugins/promo'
import catalogoData from '~/data/catalogo.json'
import categoriesData from '~/data/categories.json'

/**
 * PROMOCIONES POR FECHA (hidratadas por app/plugins/promo.ts con la decisión del
 * SERVIDOR): en los códigos en promoción, price = precio con descuento,
 * regularPrice = precio pleno (tachado real, sin gancho ficticio encima) y `promo`
 * lleva el texto para la PDP. La cinta "-N %" la calcula la UI con regularPrice.
 * Sin promociones activas la lista vuelve intacta.
 */
function applyPromos(products: Product[], activas: PromocionActiva[]): Product[] {
  if (!activas.length) return products
  return products.map((p) => {
    const { precio, precioPleno, promo } = precioEfectivo(p.code, p.price, activas)
    if (!promo) return p
    return { ...p, price: precio, regularPrice: precioPleno, promo: { id: promo.id, nombre: promo.nombre, pct: promo.pct, texto: promo.texto } }
  })
}

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

interface StockAgotado { enabled: boolean, agotados: string[], tallas: Record<string, string[]> }

/**
 * LÓGICA DE AGOTADO (módulo de inventario, hidratada por app/plugins/stock.ts):
 * producto totalmente agotado → SE QUEDA en el catálogo con la cinta AGOTADO y
 * todas sus tallas bloqueadas (antes desaparecía del catálogo, así que la cinta
 * nunca podía verse); talla agotada → soldOutSizes (la PDP la muestra
 * deshabilitada). Sin stock aplicable, no cambia nada.
 */
function applyStock(products: Product[], stock: StockAgotado | null): Product[] {
  if (!stock?.enabled) return products
  const agotados = new Set(stock.agotados)
  return products.map((p) => {
    if (p.code && agotados.has(p.code)) {
      // Referencia agotada: cinta + ninguna talla seleccionable (no se puede añadir al carrito).
      // AGOTADO va primero y desplaza a NUEVO: si un producto tuviera las dos, gana AGOTADO.
      const badges = [{ variant: 'soldout' as const, label: 'Agotado' }, ...(p.badges ?? []).filter(b => b.variant !== 'new')]
      return { ...p, badges, soldOutSizes: [...p.sizes] }
    }
    const outs = p.code ? stock.tallas[p.code] : undefined
    if (!outs?.length) return p
    const soldOut = p.sizes.filter(s => outs.some(o => String(o) === String(s)))
    return soldOut.length ? { ...p, soldOutSizes: soldOut } : p
  })
}

/** ¿El producto está totalmente agotado? (lleva la cinta AGOTADO) */
export const isSoldOut = (p: Product): boolean => !!p.badges?.some(b => b.variant === 'soldout')

/**
 * Los agotados van al FINAL de cualquier listado: siguen visibles (el cliente
 * interesado puede escribir y preguntar) pero no encabezan. Estable: dentro de
 * cada grupo se respeta el orden que traía la lista.
 */
export function agotadosAlFinal<T extends Product>(list: T[]): T[] {
  if (!list.some(isSoldOut)) return list
  return [...list].sort((a, b) => Number(isSoldOut(a)) - Number(isSoldOut(b)))
}

// memo por identidad de la fuente: la proyección solo se recalcula cuando
// cambia el array de origen (local <-> remoto hidratado) o el estado de stock
let memoSource: ProductoCatalogo[] | null = null
let memoStock: StockAgotado | null | undefined
let memoPromo: PromoState | null | undefined
let memoImagesSource: 'local' | 'woo' | undefined
let memoProducts: Product[] = []

export const useProducts = () => {
  const remoto = useState<ProductoCatalogo[] | null>('catalogo-remoto', () => null)
  const stock = useState<StockAgotado | null>('stock-agotado', () => null)
  const promo = useState<PromoState | null>('promo-activas', () => null)
  const source = remoto.value ?? CATALOGO_LOCAL
  // Origen de las imágenes (Fase B): 'woo' solo con NUXT_PUBLIC_IMAGES_SOURCE=woo; default local.
  const imagesSource = useRuntimeConfig().public.imagesSource === 'woo' ? 'woo' : 'local'
  if (source !== memoSource || stock.value !== memoStock || promo.value !== memoPromo || imagesSource !== memoImagesSource) {
    memoSource = source
    memoStock = stock.value
    memoPromo = promo.value
    memoImagesSource = imagesSource
    memoProducts = applyStock(applyPromos(catalogoToProducts(source, imagesSource), promo.value?.activas ?? []), stock.value)
  }
  const products = memoProducts
  const categories = categoriesData as Category[]

  // Hoy los datos llegan resueltos antes del render (JSON local o payload del
  // plugin), así que pending = false; los skeletons quedan listos para estados
  // de carga reales si el catálogo pasa a cargarse en cliente.
  const pending = ref(false)

  // Los agotados salen al final de cada listado (siguen visibles, con su cinta).
  const featured = agotadosAlFinal(products.filter(p => p.featured))

  // Un producto puede vivir en varias categorías (unisex -> ninos Y ninas)
  const byCategory = (slug: string) => agotadosAlFinal(products.filter(p => (p.categorySlugs ?? [p.categorySlug]).includes(slug)))
  // Públicos de la taxonomía oficial (la PLP navega por estos; ver useCatalogNav)
  const byPublico = (slug: string) => agotadosAlFinal(products.filter(p => p.publicos?.includes(slug)))
  const bySlug = (slug: string) => products.find(p => p.slug === slug)
  const categoryBySlug = (slug: string) => categories.find(c => c.slug === slug)

  return { products, categories, featured, pending, byCategory, byPublico, bySlug, categoryBySlug }
}
