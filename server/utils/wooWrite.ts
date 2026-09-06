/**
 * Credenciales de ESCRITURA de WooCommerce, en un solo sitio.
 *
 * Nombre actual: NUXT_WOO_WRITE_CONSUMER_KEY / _SECRET (la llave "Checkout
 * Orders v2", Read/Write; en Woo una llave sirve para órdenes Y productos).
 * Nombre anterior: NUXT_WOO_ORDERS_CONSUMER_KEY / _SECRET — se sigue leyendo
 * como RESPALDO para que el checkout no se rompa mientras Vercel migra al
 * nombre nuevo. Lo usan server/utils/wooOrders.ts (órdenes) y
 * server/utils/inventoryWoo.ts (inventario).
 */
export interface WooWriteCredentials {
  baseUrl: string
  key: string
  secret: string
  /** 'write' = nombre nuevo; 'orders' = respaldo legado */
  origen: 'write' | 'orders'
}

export function wooWriteCredentials(): WooWriteCredentials | null {
  const c = useRuntimeConfig()
  if (!c.wooBaseUrl) return null
  if (c.wooWriteConsumerKey && c.wooWriteConsumerSecret) {
    return { baseUrl: c.wooBaseUrl, key: c.wooWriteConsumerKey, secret: c.wooWriteConsumerSecret, origen: 'write' }
  }
  if (c.wooOrdersConsumerKey && c.wooOrdersConsumerSecret) {
    return { baseUrl: c.wooBaseUrl, key: c.wooOrdersConsumerKey, secret: c.wooOrdersConsumerSecret, origen: 'orders' }
  }
  return null
}

export function wooWriteConfigured(): boolean {
  return wooWriteCredentials() !== null
}

/** Los FetchError de Woo traen las llaves en la URL; se redactan antes de loggear. */
export const sanitizeWooWriteError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/(consumer_key|consumer_secret)=[^&"'\s]+/g, '$1=***')

/** Llamada a wc/v3 con la llave de escritura. Lanza si no hay llave. */
export async function wooWriteFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, query?: Record<string, string | number> } = {},
): Promise<T> {
  const cred = wooWriteCredentials()
  if (!cred) throw new Error('WooCommerce sin llave de escritura (WOO_WRITE_CONSUMER_KEY / WOO_WRITE_CONSUMER_SECRET)')
  return await $fetch<T>(`${cred.baseUrl}/wp-json/wc/v3${path}`, {
    method: (opts.method ?? 'GET') as never,
    body: opts.body as never,
    query: { ...(opts.query ?? {}), consumer_key: cred.key, consumer_secret: cred.secret },
    timeout: 20_000,
  })
}
