import { dbConfigured, ensureSchema, sql } from './db'

/**
 * CANDADO POR PAGO (tabla `pagos_mp`). Mercado Pago envía varias notificaciones por
 * cada pago aprobado (payment.created, payment.updated, reintentos) y llegan como
 * invocaciones serverless en paralelo. Buscar la orden en Woo antes de crearla NO es
 * un candado: las dos consultan antes de que ninguna haya creado y las dos crean
 * (pasó con las órdenes #770 y #771). Aquí decide la PRIMARY KEY de Postgres.
 *
 * Estados: procesando → (creada | fallida). Una fila `fallida`, o una `procesando`
 * más vieja que PAGO_PROCESANDO_VIEJO_MIN (su dueño murió), se puede retomar.
 *
 * Solo se llama con pagos que MP reporta `approved`: un pago pendiente o rechazado
 * nunca deja fila.
 */

/**
 * Minutos tras los que un `procesando` se considera abandonado. Tiene que ser MAYOR
 * que la duración máxima de la función en Vercel (5 min): por debajo de eso, el dueño
 * original podría seguir vivo y se crearían dos órdenes.
 */
export const PAGO_PROCESANDO_VIEJO_MIN = 10

export type TomaDePago =
  | { resultado: 'tomado', intentos: number }
  | { resultado: 'creada', orderId: number | null }
  | { resultado: 'ocupado' }

/** ¿Se puede usar el candado? Sin base no se procesa ningún pago (el llamador responde 503). */
export async function pagosMpDisponible(): Promise<boolean> {
  if (!dbConfigured()) return false
  try {
    await ensureSchema()
    return true
  }
  catch {
    return false
  }
}

/**
 * Intenta quedarse con el pago. Atómico en cada paso:
 *  1. INSERT … ON CONFLICT DO NOTHING: si devuelve fila, este proceso es el dueño.
 *  2. Si ya existía, UPDATE condicional: solo gana si está `fallida` o `procesando` vieja.
 *  3. Si tampoco, se lee el estado: `creada` → duplicado; `procesando` reciente → ocupado.
 */
export async function tomarPago(paymentId: string): Promise<TomaDePago> {
  const q = sql()
  const nuevo = await q.query(
    `INSERT INTO pagos_mp (payment_id) VALUES ($1) ON CONFLICT (payment_id) DO NOTHING RETURNING intentos`,
    [paymentId],
  ) as { intentos: number }[]
  if (nuevo.length) return { resultado: 'tomado', intentos: nuevo[0]!.intentos }

  const retomado = await q.query(
    `UPDATE pagos_mp SET estado = 'procesando', intentos = intentos + 1, updated_at = now()
      WHERE payment_id = $1
        AND (estado = 'fallida' OR (estado = 'procesando' AND updated_at < now() - make_interval(mins => $2)))
      RETURNING intentos`,
    [paymentId, PAGO_PROCESANDO_VIEJO_MIN],
  ) as { intentos: number }[]
  if (retomado.length) return { resultado: 'tomado', intentos: retomado[0]!.intentos }

  const fila = await q.query(`SELECT estado, order_id FROM pagos_mp WHERE payment_id = $1`, [paymentId]) as { estado: string, order_id: string | number | null }[]
  if (fila[0]?.estado === 'creada') return { resultado: 'creada', orderId: fila[0].order_id == null ? null : Number(fila[0].order_id) }
  // `procesando` reciente (o una fila que cambió entre consultas): otro proceso lo tiene.
  return { resultado: 'ocupado' }
}

export async function marcarPagoCreado(paymentId: string, orderId: number): Promise<void> {
  await sql().query(`UPDATE pagos_mp SET estado = 'creada', order_id = $2, updated_at = now() WHERE payment_id = $1`, [paymentId, orderId])
}

export async function marcarPagoFallido(paymentId: string): Promise<void> {
  await sql().query(`UPDATE pagos_mp SET estado = 'fallida', updated_at = now() WHERE payment_id = $1 AND estado = 'procesando'`, [paymentId])
}
