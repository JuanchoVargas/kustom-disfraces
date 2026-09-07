import { avisarVentanaPorVencer } from '../../utils/ventana24h'

/**
 * Cron DIARIO (vercel.json): aviso de ventana de 24 h por vencer. La lógica y la
 * revisión oportunista desde la bandeja viven en server/utils/ventana24h.ts.
 */
export default defineEventHandler(async () => avisarVentanaPorVencer())
