// RESTAURAR STOCK DE WOO — local, sin red ni base.
//
//   node scripts/test-restaurar-woo.mjs
//
// Comprueba la comparación respaldo ↔ Woo (pura) y, sobre la fuente, que la restauración
// solo escribe los tres campos de stock, pasa por la guarda y que restaurar-woo.mjs es
// EN SECO por defecto.
import { readFileSync } from 'node:fs'
import { calcularRestauracion, estadoStock } from './lib/restauracion-woo.mjs'

let fails = 0
const ok = (c, t, d = '') => { console.log(`${c ? '✅' : '❌'} ${t}${d ? ` — ${d}` : ''}`); if (!c) fails++ }
const leer = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const sinGestion = (id, sku) => ({ id, sku, manage_stock: false, stock_quantity: null, stock_status: 'instock', regular_price: '75000' })
const respaldo = [
  { id: 100, sku: '001006004-P', name: 'Lady Bug', status: 'publish', variaciones: [sinGestion(469, '001006004-P-T0'), sinGestion(475, '001006004-P-T12')] },
  { id: 200, sku: '001001008', name: 'Batman', status: 'publish', variaciones: [sinGestion(801, '001001008-T8'), sinGestion(802, '001001008-T10')] },
]
const hoy = new Map([
  // Lady Bug tras el piloto y una venta que dejó T12 en 0 → Woo la marcó outofstock
  [100, [{ id: 469, sku: '001006004-P-T0', manage_stock: true, stock_quantity: 5, stock_status: 'instock', regular_price: '80000' }, { id: 475, sku: '001006004-P-T12', manage_stock: true, stock_quantity: 0, stock_status: 'outofstock' }]],
  // Batman intacto; la 802 ya no existe y la 801 cambió de SKU
  [200, [{ id: 801, sku: '001001008-T6', manage_stock: false, stock_quantity: null, stock_status: 'instock' }]],
])

const r = calcularRestauracion(respaldo, hoy)
ok(r.cambios.length === 2 && r.cambios.every(c => c.sku.startsWith('001006004-P-')), '1. solo salen las variaciones que difieren del respaldo', r.cambios.map(c => c.sku).join(', '))
const t12 = r.cambios.find(c => c.sku === '001006004-P-T12')
ok(t12.despues.manage_stock === false && t12.despues.stock_quantity === null && t12.despues.stock_status === 'instock', '1. una talla que llegó a 0 vuelve a "sin gestionar" Y a instock (si no, quedaría agotada para siempre)', JSON.stringify(t12.despues))
ok(JSON.stringify(Object.keys(t12.despues).sort()) === '["manage_stock","stock_quantity","stock_status"]', '1. el cambio lleva SOLO manage_stock, stock_quantity y stock_status (el precio distinto de T0 se ignora)')
ok(r.avisos.length === 2 && r.avisos.some(a => /ya no existe/.test(a)) && r.avisos.some(a => /hoy es 001001008-T6/.test(a)), '2. variación borrada o con el SKU cambiado: se avisa y NO se toca', r.avisos.join(' | '))

const solo = calcularRestauracion(respaldo, hoy, ['001006004-P-T0'])
ok(solo.cambios.length === 1 && solo.cambios[0].sku === '001006004-P-T0' && solo.avisos.length === 0, '3. --sku con un SKU de talla limita a esa talla')
ok(calcularRestauracion(respaldo, hoy, ['001006004-P']).cambios.length === 2, '3. --sku con el código de producto toma todas sus tallas')

const igual = calcularRestauracion(respaldo, new Map([[100, respaldo[0].variaciones], [200, respaldo[1].variaciones]]))
ok(igual.cambios.length === 0 && igual.iguales === 4, '4. Woo igual al respaldo → nada que restaurar')
ok(estadoStock({ manage_stock: false, stock_quantity: 3, stock_status: 'instock' }).stock_quantity === null && estadoStock({ manage_stock: true, stock_quantity: null, stock_status: 'instock' }).stock_quantity === 0, '4. cantidades normalizadas: sin gestión = null; con gestión y vacío = 0')

// ───────── sobre la fuente ─────────
const woo = leer('server/utils/inventoryWoo.ts')
const fn = woo.slice(woo.indexOf('export async function restaurarStockWoo'), woo.indexOf('export function createWooStore'))
ok(/escribirLoteWoo\(/.test(fn) && !/regular_price|sale_price|image|status:\s*'(publish|draft)'/.test(fn), '5. restaurarStockWoo escribe por el lote común y no nombra precio, imagen ni estado del producto')
ok(/\{ manage_stock: true, stock_quantity: normalizeStock\(it\.stock_quantity\), stock_status: it\.stock_status \}/.test(fn) && /\{ manage_stock: false, stock_status: it\.stock_status \}/.test(fn), '5. cuerpo exacto: con gestión {manage_stock, stock_quantity, stock_status}; sin gestión {manage_stock:false, stock_status}')
const nucleo = woo.slice(woo.indexOf('async function escribirLoteWoo'), woo.indexOf('/** Estado de stock de una variación'))
ok(nucleo.indexOf('guardDraft(r.product)') > 0 && nucleo.indexOf('guardDraft(r.product)') < nucleo.indexOf('variations/batch'), '6. el lote común pasa la guarda ANTES de llamar a Woo')
ok(/async bulkUpdate\(operations, ctx\) \{\n\s+return await escribirLoteWoo\(/.test(woo), '6. bulkUpdate usa ese mismo lote (una sola ruta de escritura)')
const ep = leer('server/api/inventario/restaurar-woo.post.ts')
ok(/requireInbox\(event\)/.test(ep) && /restaurarStockWoo\(/.test(ep) && /origen: 'script'/.test(ep) && !/wooWriteFetch|getInventoryStore/.test(ep), '7. el endpoint exige sesión, escribe solo por restaurarStockWoo y no depende del adaptador activo')
const script = leer('scripts/restaurar-woo.mjs')
const iSeco = script.indexOf("if (!APLICAR) {"), iLogin = script.indexOf('/api/inbox/login'), iPost = script.indexOf('/api/inventario/restaurar-woo`')
ok(iSeco > 0 && iSeco < iLogin && iLogin < iPost && /process\.exit\(0\) \}\n\s+if \(!BASE\)/.test(script), '8. restaurar-woo.mjs es EN SECO por defecto: sin --aplicar termina antes de iniciar sesión o escribir')
ok(!/WRITE_CONSUMER|ORDERS_CONSUMER/.test(script + leer('scripts/respaldo-woo.mjs') + leer('scripts/lib/woo-lectura.mjs')), '8. ningún script usa llaves de escritura de Woo')

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo correcto')
process.exitCode = fails ? 1 : 0
