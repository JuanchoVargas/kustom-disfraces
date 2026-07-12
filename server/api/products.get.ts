import type { Product } from '~~/shared/types/woo'

/**
 * PROXY a WooCommerce — PLANTILLA para Fase D.
 *
 * Este endpoint corre SOLO en el servidor: las API keys (runtimeConfig, sin
 * rama `public`) nunca llegan al cliente. El frontend llamará a `/api/products`
 * en vez de leer el JSON local (ver app/composables/useProducts.ts y README).
 *
 * Hoy devuelve un error claro hasta que el cliente tenga el hosting + llaves.
 */
export default defineEventHandler(async (): Promise<Product[]> => {
  const { wooBaseUrl, wooConsumerKey, wooConsumerSecret } = useRuntimeConfig()

  if (!wooBaseUrl || !wooConsumerKey || !wooConsumerSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'WooCommerce aún no configurado. Define NUXT_WOO_* en .env (Fase D).',
    })
  }

  // --- Fase D: descomentar y completar el mapeo Woo -> Product ---
  //
  // const raw = await $fetch<any[]>(`${wooBaseUrl}/wp-json/wc/v3/products`, {
  //   query: {
  //     consumer_key: wooConsumerKey,
  //     consumer_secret: wooConsumerSecret,
  //     per_page: 100,
  //   },
  // })
  //
  // return raw.map<Product>(w => ({
  //   id: w.id,
  //   name: w.name,
  //   slug: w.slug,
  //   price: Number(w.price),
  //   regularPrice: w.on_sale ? Number(w.regular_price) : undefined,
  //   sizes: ... // de los atributos/variaciones de Woo
  //   badges: ...
  //   images: w.images?.map((i: any) => i.src) ?? [],
  //   categorySlug: w.categories?.[0]?.slug ?? '',
  //   featured: w.featured,
  //   description: w.short_description,
  // }))

  return []
})
