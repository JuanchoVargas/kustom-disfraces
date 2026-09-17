import { marcarPagoCreado, marcarPagoFallido, pagosMpDisponible, tomarPago } from './pagosMp'

/**
 * PROCESA UN PAGO DE MERCADO PAGO → a lo sumo UNA orden en WooCommerce.
 *
 * Toda la lógica del webhook vive aquí, con sus efectos externos INYECTADOS (`deps`):
 * el handler HTTP pasa las implementaciones reales y scripts/test-pagos-mp.mjs pasa
 * dobles, así la carrera se prueba contra la base de pruebas sin tocar MP, Woo ni el
 * correo, y sin ningún "modo simulación" en el camino de producción.
 *
 * Orden de operaciones:
 *   consultar el pago en MP → (solo approved) → tomar el pago en `pagos_mp` →
 *   buscar la orden en Woo (segunda barrera) → crear → marcar `creada` →
 *   ajuste manual si hace falta → correos.
 *
 * Respuestas (el handler las traduce a HTTP):
 *   200  procesado, duplicado, o pago no aprobado (no deja fila)
 *   409  otro proceso tiene el pago AHORA; MP reintenta y encontrará `creada`
 *   500  no se pudo consultar el pago en MP
 *   503  sin base de datos, o falló Woo: la fila queda `fallida` y MP reintenta
 *
 * Logs: solo ids de negocio (paymentId, orden). Nunca datos del comprador.
 */

export interface PagoMp {
  id: number | string
  status: string // approved | rejected | pending | in_process | cancelled | refunded…
  status_detail?: string
  transaction_amount: number
  external_reference?: string
  payer?: { email?: string, first_name?: string, last_name?: string }
  additional_info?: { items?: unknown[] }
  metadata?: Record<string, unknown>
  order?: { id?: number }
}

export interface OrdenCreada {
  id: number
  /** Motivos de ajuste manual que YA quedaron escritos en la orden al crearla (línea sin enlazar, montos). */
  ajustesRegistrados: string[]
  /** Motivos detectados DESPUÉS de crearla (una línea resuelta que Woo devolvió con variation_id 0). */
  ajustesPendientes: string[]
}

export type CorreoPagoMp =
  | { tipo: 'confirmacion', pago: PagoMp, orderId: number }
  | { tipo: 'ajuste_manual', pago: PagoMp, orderId: number, motivos: string[] }
  | { tipo: 'fallo', pago: PagoMp, motivo: string }

export interface DepsPagoMp {
  /** Estado REAL del pago según la API de MP (nunca el cuerpo de la notificación). */
  consultarPago: (paymentId: string) => Promise<PagoMp>
  /** Segunda barrera: ¿ya hay en Woo una orden con este pago? */
  buscarOrden: (paymentId: string) => Promise<{ id: number } | null>
  crearOrden: (pago: PagoMp) => Promise<OrdenCreada>
  /** Deja en la orden la marca y la nota de ajuste manual detectado tras crearla. */
  marcarAjuste: (orderId: number, motivos: string[]) => Promise<void>
  /** Correos al cliente y a ventas. No debe lanzar; si lanza, se registra y se sigue. */
  enviarCorreos: (correo: CorreoPagoMp) => Promise<{ sent?: boolean } | void>
}

export interface ResultadoPagoMp {
  status: 200 | 409 | 500 | 503
  body: Record<string, unknown>
}

const texto = (err: unknown) => String((err as Error)?.message ?? err)

export async function procesarPagoMp(paymentId: string, deps: DepsPagoMp): Promise<ResultadoPagoMp> {
  // ---------- 1) estado real del pago ----------
  let pago: PagoMp
  try {
    pago = await deps.consultarPago(paymentId)
  }
  catch (err) {
    console.error(`[mp-webhook] no se pudo consultar el pago ${paymentId} en MP:`, texto(err))
    return { status: 500, body: { message: 'No se pudo verificar el pago' } }
  }
  const id = String(pago.id)
  console.info(`[mp-webhook] pago ${id}: ${pago.status} (${pago.status_detail ?? '-'}) — $${pago.transaction_amount} ref=${pago.external_reference ?? '-'}`)

  // Solo un pago APROBADO genera orden y fila. pending / in_process / rejected → 200 y nada más.
  if (pago.status !== 'approved') {
    return { status: 200, body: { received: true, verified: true, status: pago.status } }
  }

  const correo = async (c: CorreoPagoMp) => {
    try {
      return await deps.enviarCorreos(c)
    }
    catch (err) {
      console.error(`[mp-webhook] fallo enviando correo (${c.tipo}) del pago ${id}:`, (err as Error)?.name || 'Error')
    }
  }

  // ---------- 2) candado ----------
  // Sin base no hay candado, y sin candado vuelve la carrera: no se toca Woo. MP reintenta.
  if (!(await pagosMpDisponible())) {
    console.error(`[mp-webhook] ⚠️ pago APROBADO ${id} sin procesar: base de datos no disponible — 503 para que MP reintente`)
    await correo({ tipo: 'fallo', pago, motivo: 'sin_base_de_datos' })
    return { status: 503, body: { message: 'Base de datos no disponible; el pago se procesará en el reintento' } }
  }

  let toma: Awaited<ReturnType<typeof tomarPago>>
  try {
    toma = await tomarPago(id)
  }
  catch (err) {
    console.error(`[mp-webhook] ⚠️ pago APROBADO ${id} sin procesar: fallo tomando el pago en pagos_mp (${(err as Error)?.name || 'Error'}) — 503`)
    await correo({ tipo: 'fallo', pago, motivo: 'sin_base_de_datos' })
    return { status: 503, body: { message: 'Base de datos no disponible; el pago se procesará en el reintento' } }
  }
  if (toma.resultado === 'creada') {
    console.info(`[mp-webhook] pago ${id} ya procesado (Woo #${toma.orderId ?? '?'}) — no se duplica`)
    return { status: 200, body: { received: true, verified: true, status: pago.status, orderId: toma.orderId, duplicate: true } }
  }
  if (toma.resultado === 'ocupado') {
    console.info(`[mp-webhook] pago ${id} lo está procesando otra notificación — 409`)
    return { status: 409, body: { message: 'Pago en proceso por otra notificación' } }
  }
  if (toma.intentos > 1) console.info(`[mp-webhook] pago ${id} retomado (intento ${toma.intentos})`)

  // A partir de aquí este proceso es el DUEÑO del pago.
  const fallar = async (motivo: string): Promise<ResultadoPagoMp> => {
    // El detalle para recuperar el pedido (paymentId + SKU) lo registra enviarCorreos('fallo').
    console.error(`[mp-webhook] pago ${id} → fila fallida (${motivo}); 503 para que MP reintente`)
    await marcarPagoFallido(id).catch(err => console.error(`[mp-webhook] no se pudo marcar fallida la fila del pago ${id}:`, (err as Error)?.name || 'Error'))
    await correo({ tipo: 'fallo', pago, motivo })
    return { status: 503, body: { message: `Pago verificado pero no se pudo crear la orden (${motivo})` } }
  }

  // ---------- 3) segunda barrera: la orden ya existe en Woo ----------
  // Cubre las órdenes anteriores a esta tabla y el caso "se creó la orden pero no se
  // alcanzó a marcar `creada`".
  let existente: { id: number } | null
  try {
    existente = await deps.buscarOrden(id)
  }
  catch (err) {
    return await fallar(`woo_error: ${texto(err)}`)
  }
  if (existente) {
    console.info(`[mp-webhook] orden ya existía en Woo para el pago ${id} (Woo #${existente.id}) — no se duplica`)
    await marcarPagoCreado(id, existente.id).catch(err => console.error(`[mp-webhook] ⚠️ no se pudo marcar creada la fila del pago ${id}:`, (err as Error)?.name || 'Error'))
    return { status: 200, body: { received: true, verified: true, status: pago.status, orderId: existente.id, duplicate: true } }
  }

  // ---------- 4) crear ----------
  let orden: OrdenCreada
  try {
    orden = await deps.crearOrden(pago)
  }
  catch (err) {
    return await fallar(`woo_error: ${texto(err)}`)
  }
  console.info(`[mp-webhook] orden creada en Woo #${orden.id} (pago ${id})`)

  // ---------- 5) cerrar el candado ----------
  // Si esto falla la orden YA existe: no se responde error (MP reintentaría) ni se
  // repiten correos. La fila queda `procesando`; al vencer, el reintento la retoma,
  // la segunda barrera encuentra la orden y la marca `creada`.
  await marcarPagoCreado(id, orden.id).catch(err =>
    console.error(`[mp-webhook] ⚠️ ALERTA: orden Woo #${orden.id} creada pero no se pudo marcar creada la fila del pago ${id} (${(err as Error)?.name || 'Error'}); la segunda barrera lo recupera`))

  // ---------- 6) ajuste manual ----------
  const motivos = [...orden.ajustesRegistrados, ...orden.ajustesPendientes]
  if (orden.ajustesPendientes.length) {
    // Se escriben TODOS los motivos: la marca de la orden es una sola y se reemplaza.
    await deps.marcarAjuste(orden.id, motivos).catch(err =>
      console.error(`[mp-webhook] no se pudo dejar la marca de ajuste manual en Woo #${orden.id}:`, texto(err)))
  }
  if (motivos.length) {
    console.error(`[mp-webhook] ⚠️ AJUSTE MANUAL en Woo #${orden.id} (pago ${id}): ${motivos.join(' · ')}`)
    await correo({ tipo: 'ajuste_manual', pago, orderId: orden.id, motivos })
  }

  // ---------- 7) confirmación ----------
  // Solo el dueño del pago llega aquí: una notificación repetida ya no duplica correos.
  const enviado = await correo({ tipo: 'confirmacion', pago, orderId: orden.id })
  return { status: 200, body: { received: true, verified: true, status: pago.status, orderId: orden.id, emailSent: !!(enviado && enviado.sent) } }
}
