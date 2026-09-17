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
interface WooOrderLine { id?: number, name?: string, product_id?: number, variation_id?: number, sku?: string }
interface WooOrder {
  id: number
  status: string
  total: string
  meta_data?: WooOrderMeta[]
  line_items?: WooOrderLine[]
}

export interface OrderItemInput {
  sku?: string
  title: string
  quantity: number
  unitPrice: number
  /** Talla ya limpia (sin la gama). Se usa para resolver la variación en Woo. */
  talla?: string | null
}

/** Una línea que NO se pudo enlazar a su variación: la orden se crea igual, marcada. */
export interface LineaSinEnlazar {
  sku?: string
  title: string
  talla?: string | null
  motivo: string
}
export interface CreateOrderInput {
  paymentId: string
  payerFirstName?: string
  payerLastName?: string
  payerEmail?: string
  items: OrderItemInput[]
  /** Total pagado según MP (respaldo si no hay ítems detallados). */
  amount: number
  /** Datos del comprador capturados en /checkout (Fase 5): billing + shipping + documento. */
  buyer?: CreateOrderBuyer
  /** Motivo adicional de ajuste manual (p. ej. montos anclados que no cuadran con lo cobrado). */
  ajusteManual?: string
}

export interface CreateOrderBuyer {
  nombre?: string
  tipoDocumento?: string
  documento?: string
  email?: string
  telefono?: string
  pais?: string
  departamento?: string
  ciudad?: string
  localidad?: string
  barrio?: string
  direccion?: string
  notas?: string
}

/** ¿Hay llave de escritura configurada? Sin ella no se crea orden (solo se registra).
 *  Lee NUXT_WOO_WRITE_* y, como respaldo, las antiguas NUXT_WOO_ORDERS_* (wooWrite.ts). */
export function wooOrdersConfigured(): boolean {
  return wooWriteConfigured()
}

async function wooOrdersFetch<T>(
  path: string,
  opts: { method?: string, query?: Record<string, string | number>, body?: unknown } = {},
): Promise<T> {
  const cred = wooWriteCredentials()
  if (!cred) throw new Error('WooCommerce sin llave de escritura')
  return await $fetch<T>(`${cred.baseUrl}/wp-json/wc/v3${path}`, {
    method: opts.method as never,
    body: opts.body as never,
    query: {
      ...(opts.query ?? {}),
      consumer_key: cred.key,
      consumer_secret: cred.secret,
    },
    timeout: 15_000,
  })
}

/** Los FetchError de Woo traen las llaves en la URL; se redactan antes de loggear. */
export const sanitizeWooOrderError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/(consumer_key|consumer_secret)=[^&"'\s]+/g, '$1=***')

/**
 * Busca una orden ya creada para este pago. Escanea las órdenes recientes por la
 * meta `_mp_payment_id`. NO es un candado (dos webhooks simultáneos consultan antes
 * de que ninguno cree: así nacieron #770 y #771): el candado es la tabla `pagos_mp`
 * (pagosMp.ts). Esto queda como SEGUNDA barrera, para las órdenes anteriores a la
 * tabla y para una fila que no se alcanzó a marcar `creada`.
 */
export async function findWooOrderByPaymentId(paymentId: string): Promise<WooOrder | null> {
  const orders = await wooOrdersFetch<WooOrder[]>('/orders', {
    query: { per_page: 50, orderby: 'date', order: 'desc', status: 'any' },
  })
  return orders.find(o =>
    o.meta_data?.some(m => m.key === MP_PAYMENT_META && String(m.value) === String(paymentId)),
  ) ?? null
}

/**
 * Crea la orden en Woo: estado processing (pagado), pagador y referencia de MP.
 *
 * ENLACE DE LÍNEAS. Cada línea resuelta lleva SOLO `variation_id` (resuelto desde
 * el SKU del producto + la talla). Ni `sku` ni `product_id`: el controlador de Woo
 * (`WC_REST_Orders_V2_Controller::get_product_id`) mira PRIMERO el `sku`, y con el
 * SKU del padre enlazaba el producto variable e ignoraba el `variation_id` que
 * venía al lado (todas las órdenes web quedaban con variation_id 0). Sin `sku`,
 * `variation_id` manda y Woo deduce el padre solo. El SKU se conserva en el
 * `meta_data` de la línea. Es lo que hace que **Woo descuente el stock de la
 * variación correcta**: `set_paid:true` dispara
 * `payment_complete()` → `wc_maybe_reduce_stock_levels`, que sin `variation_id`
 * tomaba el padre (que no gestiona stock) y no bajaba nada. Nuestro código NO toca
 * stock en ningún punto: descuenta Woo, que además es idempotente
 * (`_order_stock_reduced`) y lo devuelve solo al cancelar o reembolsar.
 *
 * SI NO SE PUEDE RESOLVER: la orden **se crea igual**. Mercado Pago ya cobró y
 * jamás se bloquea una orden pagada por una búsqueda de inventario. La línea va
 * con su `sku` y sin ids (nadie descuenta y se ajusta a mano), la
 * orden queda marcada con `_kustom_ajuste_manual`, una nota visible en wp-admin y
 * el detalle en `lineasSinEnlazar` para que el llamador dispare la alerta.
 *
 * VERIFICACIÓN POSTERIOR: si una línea que SÍ se resolvió vuelve de Woo con otro
 * `variation_id` (0 incluido), se devuelve en `lineasVariacionPerdida` para que el
 * llamador marque la orden y avise a ventas. Este fallo no vuelve a ser silencioso.
 *
 * El `name` de la línea se deja EXACTAMENTE igual que antes ("Nombre (Talla 4)"),
 * por si algo aguas abajo —rótulos, exportaciones— lo estuviera leyendo.
 */
export async function createWooOrder(input: CreateOrderInput): Promise<WooOrder & { lineasSinEnlazar: LineaSinEnlazar[], lineasVariacionPerdida: LineaSinEnlazar[] }> {
  const sinEnlazar: LineaSinEnlazar[] = []
  /** variation_id esperado por posición de línea (null = línea que no se resolvió). */
  const esperado: (number | null)[] = input.items.map(() => null)
  const lineItems = input.items.length
    ? await Promise.all(input.items.map(async (it, idx) => {
        const total = String(Math.round(it.unitPrice * it.quantity))
        const base = {
          name: it.title,
          quantity: it.quantity,
          subtotal: total,
          total,
          // El SKU queda SIEMPRE registrado en el meta de la línea.
          ...(it.sku ? { meta_data: [{ key: 'sku', value: it.sku }] } : {}),
        }
        // Resolver NUNCA puede tumbar la creación de la orden.
        let r: Awaited<ReturnType<typeof resolverProductoTalla>>
        try {
          r = await resolverProductoTalla(it.sku ?? '', it.talla)
        }
        catch (err) {
          r = { ok: false, sku: it.sku ?? '', motivo: `error resolviendo: ${String((err as Error)?.message ?? err)}` }
        }
        if (!r.ok) {
          sinEnlazar.push({ sku: it.sku, title: it.title, talla: it.talla, motivo: r.motivo ?? 'no se pudo resolver' })
          console.error(`[woo-orders] ⚠️ línea SIN enlazar (se crea igual, ajuste manual): "${it.title}" sku=${it.sku} talla=${it.talla ?? '—'} — ${r.motivo}`)
          // Sin variación solo queda el SKU del padre para que Woo enlace al menos el producto.
          return { ...base, ...(it.sku ? { sku: it.sku } : {}) }
        }
        // SOLO variation_id (ver comentario de la función): con `sku` Woo lo ignoraría.
        esperado[idx] = Number(r.variation_id)
        return { ...base, variation_id: r.variation_id }
      }))
    // Respaldo: sin ítems detallados, una sola línea con el total pagado.
    : [{ name: 'Pedido Kustom (Mercado Pago)', quantity: 1, subtotal: String(Math.round(input.amount)), total: String(Math.round(input.amount)) }]

  // Datos del comprador (Fase 5): billing + shipping + documento. Si no vienen
  // (compat), se cae al nombre/email del pagador de MP y la nota de "coordinar por WhatsApp".
  const b = input.buyer
  const nombre = (b?.nombre || [input.payerFirstName, input.payerLastName].filter(Boolean).join(' ')).trim()
  const [firstName, ...restName] = (nombre || 'Cliente').split(/\s+/)
  const lastName = restName.join(' ')
  const email = b?.email || input.payerEmail || ''

  // Woo solo tiene address_1/address_2 (no campos propios para barrio/localidad);
  // van en address_2 para que se vean en la etiqueta de envío y la factura.
  const address2 = [
    b?.barrio ? `Barrio ${b.barrio}` : '',
    b?.localidad ? `Localidad/Zona ${b.localidad}` : '',
  ].filter(Boolean).join(' — ')

  const billing = {
    first_name: firstName,
    last_name: lastName,
    email,
    ...(b?.telefono ? { phone: b.telefono } : {}),
    ...(b?.direccion ? { address_1: b.direccion } : {}),
    ...(address2 ? { address_2: address2 } : {}),
    ...(b?.ciudad ? { city: b.ciudad } : {}),
    ...(b?.departamento ? { state: b.departamento } : {}),
    ...(b ? { country: 'CO' } : {}),
  }
  const shipping = b?.direccion
    ? {
        first_name: firstName,
        last_name: lastName,
        address_1: b.direccion,
        ...(address2 ? { address_2: address2 } : {}),
        city: b.ciudad || '',
        state: b.departamento || '',
        country: 'CO',
      }
    : undefined

  // Documento VISIBLE en la orden (para la factura): en la nota del cliente y en meta.
  const docLine = b?.documento ? `Documento: ${b.tipoDocumento || 'CC'} ${b.documento}` : ''
  const notesLine = b?.notas ? `Notas del cliente: ${b.notas}` : ''
  // Aviso VISIBLE en la orden (wp-admin) cuando hay líneas sin enlazar: quien
  // despacha tiene que saber que el stock de esas tallas no bajó solo.
  const avisoAjuste = [
    sinEnlazar.length
      ? `⚠️ AJUSTE MANUAL DE INVENTARIO: ${sinEnlazar.length} línea(s) sin enlazar a su variación; Woo NO descontó su stock.\n`
        + sinEnlazar.map(l => `  · ${l.title} (${l.sku ?? 'sin SKU'}${l.talla ? `, talla ${l.talla}` : ''}) — ${l.motivo}`).join('\n')
      : '',
    input.ajusteManual ? `⚠️ AJUSTE MANUAL DE MONTOS: ${input.ajusteManual}` : '',
  ].filter(Boolean).join('\n')
  const customerNote = [
    avisoAjuste,
    b ? [docLine, notesLine].filter(Boolean).join('\n') : 'Dirección de envío a coordinar por WhatsApp',
  ].filter(Boolean).join('\n\n') || '—'

  const meta_data = [
    { key: MP_PAYMENT_META, value: String(input.paymentId) },
    // Marca de AJUSTE MANUAL: alguna línea no se pudo enlazar a su variación, así
    // que Woo no le descontó stock. Queda en la orden para poder filtrarlas luego.
    ...(sinEnlazar.length || input.ajusteManual
      ? [{ key: '_kustom_ajuste_manual', value: sinEnlazar.map(l => `${l.sku ?? '?'}${l.talla ? `-T${l.talla}` : ''}: ${l.motivo}`).concat(input.ajusteManual ? [`montos: ${input.ajusteManual}`] : []).join(' | ') }]
      : []),
    ...(b?.documento ? [{ key: '_billing_document_type', value: b.tipoDocumento || 'CC' }, { key: '_billing_document', value: b.documento }] : []),
    ...(b?.departamento ? [{ key: '_departamento', value: b.departamento }] : []),
    ...(b?.localidad ? [{ key: '_localidad', value: b.localidad }] : []),
    ...(b?.barrio ? [{ key: '_barrio', value: b.barrio }] : []),
    ...(b?.pais ? [{ key: '_pais', value: b.pais }] : []),
  ]

  const body = {
    status: 'processing', // pagado, pendiente de preparar/enviar
    set_paid: true,
    currency: 'COP',
    payment_method: 'mercadopago',
    payment_method_title: 'Mercado Pago',
    transaction_id: String(input.paymentId),
    billing,
    ...(shipping ? { shipping } : {}),
    line_items: lineItems,
    customer_note: customerNote,
    meta_data,
  }

  const orden = await wooOrdersFetch<WooOrder>('/orders', { method: 'POST', body })

  // Woo devuelve las líneas en el orden en que se enviaron.
  const perdidas: LineaSinEnlazar[] = []
  esperado.forEach((variationId, idx) => {
    if (variationId == null) return
    const devuelto = Number(orden.line_items?.[idx]?.variation_id ?? 0)
    if (devuelto === variationId) return
    const it = input.items[idx]!
    perdidas.push({ sku: it.sku, title: it.title, talla: it.talla, motivo: `se envió variation_id ${variationId} y Woo guardó ${devuelto}; Woo NO descontó el stock de esa talla` })
    console.error(`[woo-orders] ⚠️ Woo #${orden.id}: línea "${it.title}" sku=${it.sku} talla=${it.talla ?? '—'} enviada con variation_id ${variationId} y guardada con ${devuelto}`)
  })
  return { ...orden, lineasSinEnlazar: sinEnlazar, lineasVariacionPerdida: perdidas }
}

/**
 * Marca como AJUSTE MANUAL una orden YA creada (motivos detectados después de
 * crearla): meta `_kustom_ajuste_manual` para poder filtrarla y una nota privada
 * visible en wp-admin para quien despacha.
 */
export async function marcarAjusteManualWoo(orderId: number, motivos: string[]): Promise<void> {
  const detalle = motivos.join(' | ')
  await wooOrdersFetch(`/orders/${orderId}`, { method: 'PUT', body: { meta_data: [{ key: '_kustom_ajuste_manual', value: detalle }] } })
  await wooOrdersFetch(`/orders/${orderId}/notes`, { method: 'POST', body: { note: `⚠️ AJUSTE MANUAL DE INVENTARIO: ${detalle}`, customer_note: false } })
}
