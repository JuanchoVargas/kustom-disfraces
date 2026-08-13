/**
 * Creación de órdenes en WooCommerce al confirmarse un pago (Fase 3).
 * Usa una llave de Woo con permiso de ESCRITURA (wooOrders*), separada de la de
 * lectura del catálogo (mínimo privilegio). Todo server-side.
 *
 * Idempotencia: cada orden guarda el payment id de MP en meta `_mp_payment_id` y
 * en `transaction_id`. Antes de crear, se busca una orden existente con ese id.
 */

const MP_PAYMENT_META = '_mp_payment_id'

interface WooOrderMeta { key: string, value: unknown }
interface WooOrder {
  id: number
  status: string
  total: string
  meta_data?: WooOrderMeta[]
}

export interface OrderItemInput {
  sku?: string
  title: string
  quantity: number
  unitPrice: number
}
export interface CreateOrderInput {
  paymentId: string
  payerFirstName?: string
  payerLastName?: string
  payerEmail?: string
  items: OrderItemInput[]
  /** Total pagado según MP (respaldo si no hay ítems detallados). */
  amount: number
}

/** ¿Hay llave de escritura configurada? Sin ella no se crea orden (solo se registra). */
export function wooOrdersConfigured(): boolean {
  const c = useRuntimeConfig()
  return !!(c.wooBaseUrl && c.wooOrdersConsumerKey && c.wooOrdersConsumerSecret)
}

async function wooOrdersFetch<T>(
  path: string,
  opts: { method?: string, query?: Record<string, string | number>, body?: unknown } = {},
): Promise<T> {
  const { wooBaseUrl, wooOrdersConsumerKey, wooOrdersConsumerSecret } = useRuntimeConfig()
  return await $fetch<T>(`${wooBaseUrl}/wp-json/wc/v3${path}`, {
    method: opts.method as never,
    body: opts.body as never,
    query: {
      ...(opts.query ?? {}),
      consumer_key: wooOrdersConsumerKey,
      consumer_secret: wooOrdersConsumerSecret,
    },
    timeout: 15_000,
  })
}

/** Los FetchError de Woo traen las llaves en la URL; se redactan antes de loggear. */
export const sanitizeWooOrderError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/(consumer_key|consumer_secret)=[^&"'\s]+/g, '$1=***')

/**
 * Busca una orden ya creada para este pago (idempotencia). Escanea las órdenes
 * recientes por la meta `_mp_payment_id`. Nota: no es un lock atómico — dos
 * webhooks casi simultáneos podrían colarse; en la práctica MP los espacia y el
 * segundo encuentra la orden del primero. Un lock real necesitaría BD.
 */
export async function findWooOrderByPaymentId(paymentId: string): Promise<WooOrder | null> {
  const orders = await wooOrdersFetch<WooOrder[]>('/orders', {
    query: { per_page: 50, orderby: 'date', order: 'desc', status: 'any' },
  })
  return orders.find(o =>
    o.meta_data?.some(m => m.key === MP_PAYMENT_META && String(m.value) === String(paymentId)),
  ) ?? null
}

/** Crea la orden en Woo: estado processing (pagado), pagador y referencia de MP. */
export async function createWooOrder(input: CreateOrderInput): Promise<WooOrder> {
  const lineItems = input.items.length
    ? input.items.map((it) => {
        const total = String(Math.round(it.unitPrice * it.quantity))
        return {
          name: it.title,
          quantity: it.quantity,
          subtotal: total,
          total,
          ...(it.sku ? { sku: it.sku } : {}),
          // SKU también en meta: queda registrado aunque Woo no lo enlace en la creación.
          ...(it.sku ? { meta_data: [{ key: 'sku', value: it.sku }] } : {}),
        }
      })
    // Respaldo: sin ítems detallados, una sola línea con el total pagado.
    : [{ name: 'Pedido Kustom (Mercado Pago)', quantity: 1, subtotal: String(Math.round(input.amount)), total: String(Math.round(input.amount)) }]

  const body = {
    status: 'processing', // pagado, pendiente de preparar/enviar
    set_paid: true,
    currency: 'COP',
    payment_method: 'mercadopago',
    payment_method_title: 'Mercado Pago',
    transaction_id: String(input.paymentId),
    billing: {
      first_name: input.payerFirstName || '',
      last_name: input.payerLastName || '',
      email: input.payerEmail || '',
    },
    line_items: lineItems,
    customer_note: 'Dirección de envío a coordinar por WhatsApp',
    meta_data: [{ key: MP_PAYMENT_META, value: String(input.paymentId) }],
  }

  return await wooOrdersFetch<WooOrder>('/orders', { method: 'POST', body })
}
