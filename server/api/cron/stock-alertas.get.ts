import { resumenDiario } from '../../utils/stockAlerts'
import { requireCron } from '../../utils/cronAuth'

/**
 * Resumen diario de stock bajo/agotado a ventas@ (cron de Vercel, vercel.json).
 * Idempotente y best-effort: sin tallas bajas no envía nada; sin SMTP solo loguea.
 */
export default defineEventHandler(async (event) => {
  requireCron(event) // 401 sin Authorization: Bearer <CRON_SECRET>
  const t0 = Date.now()
  const r = await resumenDiario()
  console.info(`[stock-alertas] bajo=${r.bajo} agotadas=${r.agotadas} enviado=${r.enviado} (${Date.now() - t0}ms)`)
  return { ok: true, ...r, ms: Date.now() - t0 }
})
