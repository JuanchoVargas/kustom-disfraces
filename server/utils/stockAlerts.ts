import type { InvOpResult } from '~~/shared/types/inventory'
import type { StockState } from './stockState'
import { createMailTransport, mailerConfigured } from './mailer'
import { getStockState, invalidateStockState } from './stockState'

/**
 * ALERTAS DE STOCK BAJO (módulo de inventario).
 *   - En el panel: conteos en /api/inventario/estado y franja con acceso al filtro.
 *   - Por correo a ventas@ (NUXT_VENTAS_TO): (a) al instante cuando una escritura
 *     del panel deja una talla en bajo/agotado que antes no lo estaba, y (b) un
 *     resumen diario (cron /api/cron/stock-alertas) con todo lo que esté bajo o
 *     agotado. Best-effort: sin SMTP solo se registra en el log.
 */

const site = () => (useRuntimeConfig().public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')

export interface AlertRow { sku: string, producto: string, talla: string, cantidad: number }

function bajoOAgotado(after: Partial<{ manage_stock: boolean, stock_quantity: number | null }> | undefined, umbral: number): boolean {
  return !!after?.manage_stock && (after.stock_quantity ?? 0) <= umbral
}

/** Tallas que ACABAN de cruzar el umbral hacia abajo en esta tanda de escrituras. */
export function transicionesABajo(resultados: InvOpResult[], umbral: number): { sku: string, cantidad: number }[] {
  const out: { sku: string, cantidad: number }[] = []
  for (const r of resultados) {
    if (!r.ok || !bajoOAgotado(r.after, umbral)) continue
    if (bajoOAgotado(r.before, umbral)) continue // ya estaba bajo: no repetir
    out.push({ sku: r.sku, cantidad: r.after?.stock_quantity ?? 0 })
  }
  return out
}

function render(rows: AlertRow[], titulo: string, intro: string): { subject: string, text: string, html: string } {
  const agotadas = rows.filter(r => r.cantidad <= 0)
  const bajas = rows.filter(r => r.cantidad > 0)
  const line = (r: AlertRow) => `${r.producto} · talla ${r.talla} (${r.sku}): ${r.cantidad <= 0 ? 'AGOTADA' : `${r.cantidad} u`}`
  const text = [intro, '', ...(agotadas.length ? ['AGOTADAS:', ...agotadas.map(line), ''] : []), ...(bajas.length ? ['STOCK BAJO:', ...bajas.map(line), ''] : []), `Panel: ${site()}/admin/inventario`].join('\n')
  const tr = (r: AlertRow) => `<tr><td style="padding:4px 8px">${r.producto}</td><td style="padding:4px 8px">${r.talla}</td><td style="padding:4px 8px;font-family:monospace">${r.sku}</td><td style="padding:4px 8px;text-align:right;color:${r.cantidad <= 0 ? '#B00020' : '#9A5B00'}"><b>${r.cantidad <= 0 ? 'agotada' : `${r.cantidad} u`}</b></td></tr>`
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>${intro}</p><table style="border-collapse:collapse;border:1px solid #ddd"><tr style="background:#f4f2ec"><th style="padding:6px 8px;text-align:left">Producto</th><th style="padding:6px 8px">Talla</th><th style="padding:6px 8px;text-align:left">SKU</th><th style="padding:6px 8px">Stock</th></tr>${[...agotadas, ...bajas].map(tr).join('')}</table><p><a href="${site()}/admin/inventario">Abrir el panel de inventario</a></p></div>`
  return { subject: `${titulo}: ${agotadas.length} agotadas · ${bajas.length} con stock bajo`, text, html }
}

async function send(mail: { subject: string, text: string, html: string }): Promise<boolean> {
  const c = useRuntimeConfig()
  // En modo simulación (adaptador mock) NO se manda correo: el stock no es real y
  // ventas@ recibiría avisos de pruebas. Queda en el log y en el panel.
  if (getInventoryStore().simulation) { console.info(`[stock-alerta] simulación — no se envía correo: ${mail.subject}`); return false }
  if (!mailerConfigured()) { console.warn(`[stock-alerta] SMTP sin configurar — no se envía: ${mail.subject}`); return false }
  try {
    await createMailTransport().sendMail({ from: c.smtpFrom || c.smtpUser, to: c.ventasTo, subject: mail.subject, text: mail.text, html: mail.html })
    console.info(`[stock-alerta] enviado a ${c.ventasTo}: ${mail.subject}`)
    return true
  }
  catch (err) {
    console.error('[stock-alerta] fallo al enviar:', String((err as Error)?.message ?? err))
    return false
  }
}

/** Tras una tanda de escrituras: invalida el estado de stock y avisa de lo que acaba de bajar. */
export async function alertarTrasEscritura(resultados: InvOpResult[], origen: string): Promise<{ avisadas: number, enviado: boolean }> {
  invalidateStockState()
  const st = await getStockState(true)
  const nuevas = transicionesABajo(resultados, st.umbral)
  if (!nuevas.length) return { avisadas: 0, enviado: false }
  const info = new Map([...st.bajo, ...st.agotadas.map(a => ({ ...a, cantidad: 0 }))].map(r => [r.sku, r]))
  const rows: AlertRow[] = nuevas.map(n => ({ sku: n.sku, producto: info.get(n.sku)?.producto ?? n.sku, talla: info.get(n.sku)?.talla ?? n.sku.slice(n.sku.lastIndexOf('-T') + 2), cantidad: n.cantidad }))
  const enviado = await send(render(rows, 'Stock bajo (Kustom)', `Estas tallas quedaron con stock bajo o agotadas tras una actualización (${origen}${st.backend === 'mock' ? ', modo simulación' : ''}):`))
  return { avisadas: rows.length, enviado }
}

/** Resumen diario (cron): todo lo que esté bajo o agotado ahora. */
export async function resumenDiario(): Promise<{ bajo: number, agotadas: number, enviado: boolean }> {
  const st: StockState = await getStockState(true)
  const rows: AlertRow[] = [...st.agotadas.map(a => ({ ...a, cantidad: 0 })), ...st.bajo]
  if (!rows.length) return { bajo: 0, agotadas: 0, enviado: false }
  const enviado = await send(render(rows, 'Resumen de stock (Kustom)', `Estado del inventario hoy (umbral de stock bajo: ${st.umbral} u por talla${st.backend === 'mock' ? '; modo simulación' : ''}):`))
  return { bajo: st.bajo.length, agotadas: st.agotadas.length, enviado }
}
