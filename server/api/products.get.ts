import type { ProductoCatalogo } from '~~/shared/types/catalogo'

/**
 * PROXY a WooCommerce — catálogo completo en el esquema interno
 * (shape de catalogo.json; la UI lo proyecta con catalogoToProducts).
 *
 * - Corre SOLO en el servidor: las API keys (runtimeConfig sin rama `public`)
 *   nunca llegan al cliente.
 * - Caché SWR de 10 min (ver server/utils/woo.ts).
 * - FALLBACK: si Woo no responde o da error, se sirve el catálogo local y se
 *   loggea el incidente — el sitio nunca se cae por culpa de la API.
 * - `?categoria=<publico>` filtra por público (bebes|ninos|ninas|damas|caballeros).
 */
export default defineEventHandler(async (event): Promise<ProductoCatalogo[]> => {
  let catalogo: ProductoCatalogo[]
  try {
    catalogo = await getWooCatalogo()
  } catch (err) {
    console.error('[woo-proxy] Woo no respondió; FALLBACK al catálogo local.', sanitizeWooError(err))
    catalogo = CATALOGO_LOCAL
  }

  const categoria = getQuery(event).categoria
  if (typeof categoria === 'string' && categoria) {
    return catalogo.filter(i => i.disponibleWeb && i.publicos.includes(categoria as never))
  }
  return catalogo
})
