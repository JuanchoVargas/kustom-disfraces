import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import catalogoLocal from '~~/app/data/catalogo.json'

/**
 * Cliente de la REST API de WooCommerce (api.disfraceskustom.com) y adaptador
 * Woo -> esquema interno (el shape de catalogo.json que consume toda la UI).
 *
 * Estrategia de MERGE por SKU: Woo es la autoridad COMERCIAL (estado
 * publish/draft, precio, tallas, nombre, destacado); el catálogo local aporta
 * la taxonomía web (publicos, subcategoriaNav, slug, descripciones, pareja,
 * fotos — las imágenes se sirven desde el propio frontend, no desde WP).
 * Un ítem local sin producto publish en Woo queda oculto (disponibleWeb: false).
 */

export const CATALOGO_LOCAL = catalogoLocal as unknown as ProductoCatalogo[]

/** Los FetchError traen la URL con las llaves; se redactan antes de loggear. */
export const sanitizeWooError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/(consumer_key|consumer_secret)=[^&"'\s]+/g, '$1=***')

interface WooProduct {
  id: number
  sku: string
  name: string
  status: string
  price: string
  featured: boolean
  attributes?: { name: string, options: string[] }[]
}

// El mismo orden canónico de tallas del sitio (Woo las devuelve alfabéticas)
const SIZE_ORDER = ['Bebé', 0, 2, 4, 6, 8, 10, 12, 14, 'XS', 'S', 'M', 'L', 'XL']
const sizeRank = (s: number | string) => {
  const i = SIZE_ORDER.findIndex(o => String(o) === String(s))
  return i === -1 ? SIZE_ORDER.length : i
}
const normalizeTalla = (s: string): number | string => (/^\d+$/.test(s) ? Number(s) : s)

const wooFetch = async <T>(path: string, query: Record<string, string | number> = {}): Promise<T> => {
  const { wooBaseUrl, wooConsumerKey, wooConsumerSecret } = useRuntimeConfig()
  if (!wooBaseUrl || !wooConsumerKey || !wooConsumerSecret) {
    throw new Error('WooCommerce sin configurar (WOO_API_URL / WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET)')
  }
  return await $fetch<T>(`${wooBaseUrl}/wp-json/wc/v3${path}`, {
    query: { ...query, consumer_key: wooConsumerKey, consumer_secret: wooConsumerSecret },
    timeout: 15_000,
  })
}

const fetchAllWooProducts = async (): Promise<WooProduct[]> => {
  const all: WooProduct[] = []
  for (let page = 1; page <= 10; page++) {
    const batch = await wooFetch<WooProduct[]>('/products', { per_page: 100, page, status: 'publish' })
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

/** Precio de un producto variable: el del padre o, si Woo no lo ha calculado
 *  (lookup sin regenerar / variaciones recién importadas), el de su primera
 *  variación. null = Woo no tiene precio (se reporta en paridad, no se inventa). */
const resolvePrice = async (p: WooProduct): Promise<number | null> => {
  const direct = Number(p.price)
  if (p.price !== '' && !Number.isNaN(direct) && direct > 0) return direct
  try {
    const variations = await wooFetch<{ price: string }[]>(`/products/${p.id}/variations`, { per_page: 1 })
    const v = Number(variations[0]?.price)
    return variations.length && !Number.isNaN(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

const buildCatalogoFromWoo = async (): Promise<ProductoCatalogo[]> => {
  const wooProducts = await fetchAllWooProducts()
  const bySku = new Map(wooProducts.map(p => [p.sku, p]))

  // precios en paralelo controlado (solo los que Woo no trae resueltos)
  const prices = new Map<string, number | null>()
  const pending = wooProducts.filter(p => bySkuNeedsLookup(p))
  const CONCURRENCY = 4
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(pending.slice(i, i + CONCURRENCY).map(async (p) => {
      prices.set(p.sku, await resolvePrice(p))
    }))
  }

  return CATALOGO_LOCAL.map((item) => {
    const woo = bySku.get(item.codigo)
    if (!woo || woo.status !== 'publish' || !item.imagenes.length) {
      // sin producto publish en Woo (o sin foto local) -> oculto
      return { ...item, disponibleWeb: false }
    }
    const talla = woo.attributes?.find(a => a.name === 'Talla')
    const tallas = talla?.options?.length
      ? talla.options.map(normalizeTalla).sort((a, b) => sizeRank(a) - sizeRank(b))
      : item.tallas
    const precio = prices.has(woo.sku)
      ? prices.get(woo.sku) as number | null
      : Number(woo.price)
    return {
      ...item,
      disponibleWeb: true,
      nombre: woo.name,
      precio,
      tallas,
      destacado: woo.featured,
    }
  })
}

const bySkuNeedsLookup = (p: WooProduct) => p.price === '' || Number.isNaN(Number(p.price)) || Number(p.price) <= 0

/** Catálogo Woo->interno cacheado 10 min (una entrada, key 'all'): el hosting
 *  compartido recibe como máximo un refresco por ventana, no uno por visita.
 *  swr:false — al expirar revalida de forma SÍNCRONA (espera la respuesta fresca
 *  de Woo) en vez de servir stale. En serverless (Vercel) la revalidación en
 *  background del SWR moría al devolver la respuesta y dejaba datos viejos
 *  sirviéndose indefinidamente; con swr:false una request por ventana bloquea
 *  ~1-2s para traer lo fresco y el resto sale de caché. */
export const getWooCatalogo = defineCachedFunction(buildCatalogoFromWoo, {
  name: 'woo-catalogo',
  maxAge: 600,
  swr: false,
  getKey: () => 'all',
})
