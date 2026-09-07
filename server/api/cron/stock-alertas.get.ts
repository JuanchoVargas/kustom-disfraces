import { resumenDiario } from '../../utils/stockAlerts'

/**
 * Resumen diario de stock bajo/agotado a ventas@ (cron de Vercel, vercel.json).
 * Idempotente y best-effort: sin tallas bajas no envía nada; sin SMTP solo loguea.
 */
export default defineEventHandler(async () => {
  const t0 = Date.now()
  const r = await resumenDiario()
  console.info(`[stock-alertas] bajo=${r.bajo} agotadas=${r.agotadas} enviado=${r.enviado} (${Date.now() - t0}ms)`)
  return { ok: true, ...r, ms: Date.now() - t0 }
})
