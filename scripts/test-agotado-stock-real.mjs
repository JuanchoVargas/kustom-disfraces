// AGOTADO POR STOCK REAL = AGOTADO POR NUXT_SKUS_AGOTADOS — local, sin red ni base.
//
//   node scripts/test-agotado-stock-real.mjs
//
// Fija las dos reglas de negocio, vengan de donde vengan los ceros:
//   · TODAS las tallas en 0 → el producto SIGUE visible, con cinta AGOTADO, todas las
//     tallas bloqueadas, sin poder comprarse y al final de los listados. NUNCA desaparece.
//   · UNA talla en 0       → producto visible, sin cinta, solo esa talla bloqueada.
// Recorre el camino real: computeStockState (servidor) → payload de /api/stock →
// applyStock + agotadosAlFinal (web), y lo compara con el camino del override manual.
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let SKUS = ''
globalThis.useRuntimeConfig = () => ({ skusAgotados: SKUS, inventoryStockBajo: 5, public: {} })
globalThis.defineCachedFunction = fn => fn
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '@@': root, '~': `${root}app`, '@': `${root}app` } })
const { computeStockState } = await jiti.import('../server/utils/stockState.ts')
const { applyStock, agotadosAlFinal, isSoldOut } = await jiti.import('../app/composables/useProducts.ts')

let fails = 0
const ok = (c, t, d = '') => { console.log(`${c ? '✅' : '❌'} ${t}${d ? ` — ${d}` : ''}`); if (!c) fails++ }

// Códigos reales de catalogo.json (el override solo acepta SKU que existan).
const TODO_EN_0 = '001011001' // Cerdito
const UNA_EN_0 = '001006004-P' // Lady Bug
const CON_STOCK = '001001008' // Batman
const v = (codigo, talla, qty) => ({ sku: `${codigo}-T${talla}`, manage_stock: qty !== null, stock_quantity: qty, stock_status: qty === 0 ? 'outofstock' : 'instock', attributes: [{ name: 'Talla', option: String(talla) }] })
const inventario = (ceros) => [
  { sku: TODO_EN_0, name: 'Cerdito', status: 'publish', variations: ['Bebé', 0, 2, 4].map(t => v(TODO_EN_0, t, ceros ? 0 : 5)) },
  { sku: UNA_EN_0, name: 'Lady Bug', status: 'publish', variations: [0, 2, 12].map(t => v(UNA_EN_0, t, ceros && t === 12 ? 0 : 5)) },
  { sku: CON_STOCK, name: 'Batman', status: 'publish', variations: [8, 10].map(t => v(CON_STOCK, t, 5)) },
]
// Productos de la web (forma mínima de Product) en el orden en que saldrían en un listado.
const web = () => [
  { id: 1, code: TODO_EN_0, name: 'Cerdito', sizes: ['Bebé', 0, 2, 4], badges: [{ variant: 'new', label: 'Nuevo' }] },
  { id: 2, code: UNA_EN_0, name: 'Lady Bug', sizes: [0, 2, 12] },
  { id: 3, code: CON_STOCK, name: 'Batman', sizes: [8, 10] },
]
/** Lo que /api/stock entregaría para ese estado (mismo mapeo que publicStockPayload). */
const payload = st => ({ enabled: st.enabled, agotados: [...st.agotados], tallas: Object.fromEntries(st.tallasAgotadas) })
const resumen = lista => lista.map(p => `${p.code}:${isSoldOut(p) ? 'AGOTADO' : 'ok'}:[${(p.soldOutSizes ?? []).join(',')}]`).join(' ')

// ───────── A. stock REAL aplicado al sitio (adaptador woo, stock público encendido) ─────────
SKUS = ''
const real = computeStockState(inventario(true), true, 'woo')
const webReal = agotadosAlFinal(applyStock(web(), payload(real)))

ok(webReal.length === 3, 'A1. todo en 0 → el producto SIGUE en el catálogo (no se filtra nada)', `${webReal.length} de 3 productos`)
const cerdito = webReal.find(p => p.code === TODO_EN_0)
ok(isSoldOut(cerdito) && cerdito.badges[0].variant === 'soldout' && !cerdito.badges.some(b => b.variant === 'new'), 'A1. todo en 0 → lleva la cinta AGOTADO (y desplaza a NUEVO)')
ok(JSON.stringify(cerdito.soldOutSizes) === JSON.stringify(cerdito.sizes), 'A1. todo en 0 → TODAS las tallas bloqueadas: no se puede elegir ninguna ni añadir al carrito', JSON.stringify(cerdito.soldOutSizes))
ok(webReal.at(-1).code === TODO_EN_0 && webReal[0].code !== TODO_EN_0, 'A1. todo en 0 → va al FINAL del listado', webReal.map(p => p.code).join(' → '))
ok(real.agotados.has(TODO_EN_0) && ['Bebé', '0', '2', '4'].every(t => real.disponible.get(`${TODO_EN_0}-T${t}`) === 0), 'A1. todo en 0 → el checkout ve 0 disponibles en cada talla (responde 409 sin_stock)')

const lady = webReal.find(p => p.code === UNA_EN_0)
ok(!isSoldOut(lady) && JSON.stringify(lady.soldOutSizes) === '[12]', 'A2. una talla en 0 → producto visible, SIN cinta, solo esa talla bloqueada', JSON.stringify(lady.soldOutSizes))
ok(!real.agotados.has(UNA_EN_0) && real.disponible.get(`${UNA_EN_0}-T12`) === 0 && real.disponible.get(`${UNA_EN_0}-T2`) === 5, 'A2. una talla en 0 → el checkout bloquea esa talla y deja pasar las demás')
const batman = webReal.find(p => p.code === CON_STOCK)
ok(!isSoldOut(batman) && !batman.soldOutSizes, 'A3. producto con stock → intacto')

// ───────── B. el MISMO resultado por el override manual (stock real sin aplicar) ─────────
SKUS = `${TODO_EN_0}:prueba,${UNA_EN_0}-T12`
const forzado = computeStockState(inventario(false), false, 'mock')
const webForzado = agotadosAlFinal(applyStock(web(), payload(forzado)))
ok(resumen(webForzado) === resumen(webReal), 'B. NUXT_SKUS_AGOTADOS y el stock real dan EXACTAMENTE la misma web (mismos productos, cinta, tallas y orden)', resumen(webReal))
ok(JSON.stringify(payload(forzado).agotados) === JSON.stringify(payload(real).agotados) && JSON.stringify(payload(forzado).tallas) === JSON.stringify(payload(real).tallas), 'B. y el mismo payload de /api/stock')

// ───────── C. con el stock público APAGADO los ceros reales no salen a la web ─────────
SKUS = ''
const apagado = computeStockState(inventario(true), false, 'woo')
const webApagado = applyStock(web(), payload(apagado))
ok(!apagado.enabled && resumen(webApagado) === resumen(web()), 'C. stock público apagado y sin override: los ceros del inventario NO cambian la web')
ok(apagado.agotadosSinForzar.some(a => a.codigo === TODO_EN_0), 'C. …pero el panel sí avisa de que ese publicado se está vendiendo con todo en 0')

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo correcto')
process.exitCode = fails ? 1 : 0
