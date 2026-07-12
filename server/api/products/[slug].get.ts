import type { ProductoCatalogo } from '~~/shared/types/catalogo'

/**
 * PROXY a WooCommerce — un producto visible por slug web (el slug canónico es
 * el del catálogo interno, no el de WordPress). Mismo fallback que /api/products.
 */
export default defineEventHandler(async (event): Promise<ProductoCatalogo> => {
  const slug = getRouterParam(event, 'slug')
  let catalogo: ProductoCatalogo[]
  try {
    catalogo = await getWooCatalogo()
  } catch (err) {
    console.error('[woo-proxy] Woo no respondió; FALLBACK al catálogo local.', sanitizeWooError(err))
    catalogo = CATALOGO_LOCAL
  }
  const item = catalogo.find(i => i.disponibleWeb && i.slug === slug)
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado' })
  }
  return item
})
