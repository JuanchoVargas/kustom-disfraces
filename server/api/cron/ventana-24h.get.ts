import { avisarVentanaPorVencer } from '../../utils/ventana24h'
import { requireCron } from '../../utils/cronAuth'

/**
 * Cron DIARIO (vercel.json): aviso de ventana de 24 h por vencer. La lógica y la
 * revisión oportunista desde la bandeja viven en server/utils/ventana24h.ts.
 */
export default defineEventHandler(async (event) => {
  requireCron(event) // 401 sin Authorization: Bearer <CRON_SECRET>
  return avisarVentanaPorVencer()
})
