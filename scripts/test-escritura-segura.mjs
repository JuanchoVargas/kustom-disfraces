// Pruebas del CAMINO DE ESCRITURA y del ENLACE DE PEDIDOS. Sin red, sin BD, sin escribir.
//
//   node scripts/test-escritura-segura.mjs
//
// Cubre lo acordado en el Bloque 2:
//   · resolución SKU → (product_id, variation_id), incluidos los casos problemáticos
//   · camino de fallo: una resolución fallida NO puede impedir crear la orden
//   · nunca se escribe regular_price = 0
//   · el producto 747 (y el SKU 001002001) están bloqueados para escritura
//   · la talla se extrae limpia del título de Mercado Pago (sin arrastrar la gama)
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({ wooBaseUrl: 'https://api.disfraceskustom.com', public: {} })
globalThis.defineCachedFunction = fn => fn
globalThis.cachedFunction = fn => fn
globalThis.defineEventHandler = fn => fn
globalThis.createError = (e) => { const x = new Error(e?.statusMessage ?? e?.message ?? 'error'); Object.assign(x, e); return x }

const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const resolveMod = await jiti.import('../server/utils/inventoryResolve.ts')
const { tallaDesdeTitulo, PRODUCTOS_BLOQUEADOS, SKUS_BLOQUEADOS, bloqueoDe, estructuraRota } = resolveMod

let fails = 0
const check = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fails++
}

// ---------- catálogo de prueba: los tres casos que importan ----------
const CATALOGO = [
  // sano
  { id: 130, sku: '001011001', name: 'Pollito', status: 'publish', variations: [
    { id: 5001, sku: '001011001-TBebé' }, { id: 5002, sku: '001011001-T0' },
    { id: 5003, sku: '001011001-T2' }, { id: 5004, sku: '001011001-T4' },
  ] },
  // el padre lleva el SKU de su propia variación (729)
  { id: 22, sku: '001002001', name: 'Spider-Man Negro Línea Entrada', status: 'publish', variations: [
    { id: 729, sku: '001002001' }, { id: 730, sku: '001002001-T4' },
  ] },
  // 8 variaciones con el MISMO SKU; la primera no tiene talla
  { id: 747, sku: '005001001-T12', name: 'Vaquerito Woody', status: 'draft', variations: [
    { id: 760, sku: '005001001-T12' }, { id: 759, sku: '005001001-T12' },
    { id: 758, sku: '005001001-T12' }, { id: 748, sku: '005001001-T12' },
  ] },
]
// Se sustituye la lectura del inventario por el catálogo de prueba (no toca la BD).
const snapshot = await jiti.import('../server/utils/inventorySnapshot.ts')
snapshot.loadInventory = async () => ({ products: CATALOGO, origen: 'woo', fetched_at: null })

console.log('— Resolución SKU → (product_id, variation_id) —\n')
const casos = [
  ['001011001-T4', 'caso sano'],
  ['005001001-T12', 'caso problemático: 8 variaciones con el mismo SKU (producto 747)'],
  ['001002001', 'caso problemático: el padre lleva el SKU de su variación 729'],
  ['001011001-T99', 'talla que no existe'],
]
const resultados = []
for (const [sku, nota] of casos) {
  const r = await resolveMod.resolverSkuVariacion(sku)
  resultados.push([sku, r])
  console.log(`  ${sku.padEnd(18)} ${r.ok ? `✅ product_id=${r.product_id} variation_id=${r.variation_id}  (${r.producto})` : `🛑 NO se resuelve — ${r.motivo}`}`)
  console.log(`  ${' '.repeat(18)} ${nota}`)
}
check('el SKU sano resuelve a los ids correctos', resultados[0][1].ok && resultados[0][1].product_id === 130 && resultados[0][1].variation_id === 5004)
check('005001001-T12 NO resuelve (antes elegía la variación sin talla, vid 760)', !resultados[1][1].ok, resultados[1][1].motivo)
check('001002001 NO resuelve (antes ganaba el padre sobre la variación 729)', !resultados[2][1].ok, resultados[2][1].motivo)
check('un SKU inexistente no resuelve', !resultados[3][1].ok, resultados[3][1].motivo)

console.log('\n— Bloqueo de escritura —')
check('el producto 747 está bloqueado', !!PRODUCTOS_BLOQUEADOS[747] && !!SKUS_BLOQUEADOS['005001001-T12'])
// Spider-Man Negro (22) ya NO está en la lista fija: lo bloquea su ESTRUCTURA mientras exista
// la variación 729 (una sobrante "Cualquier talla" con el SKU del producto) y se desbloquea
// solo cuando se elimina en Woo y se sincroniza.
const negroRoto = CATALOGO[1]
const negroSano = { id: 22, sku: '001002001', name: 'Spider-Man Negro Línea Entrada', variations: [2, 4, 6, 8, 10, 12].map((t, i) => ({ id: 223 + i, sku: `001002001-T${t}` })) }
check('el producto 22 ya no está en la lista fija', !PRODUCTOS_BLOQUEADOS[22] && !SKUS_BLOQUEADOS['001002001'])
check('…pero sigue BLOQUEADO mientras la variación 729 lleve el SKU del producto', (bloqueoDe(negroRoto) ?? '').includes('la variación 729 lleva el SKU del propio producto (001002001)'), bloqueoDe(negroRoto) ?? 'null')
check('…y se DESBLOQUEA solo cuando esa variación ya no está (6 tallas sanas)', bloqueoDe(negroSano) === null)
check('estructuraRota() detecta dos variaciones con el mismo SKU', (estructuraRota({ id: 1, sku: 'X', variations: [{ id: 1, sku: 'X-T4' }, { id: 2, sku: 'X-T4' }, { id: 3, sku: 'X-T6' }] }) ?? '').includes('comparten SKU (X-T4 ×2)'))
check('estructuraRota() no marca un producto sin variaciones ni uno sano', estructuraRota({ id: 1, sku: 'X' }) === null && estructuraRota(CATALOGO[0]) === null)
check('bloqueoDe() marca el 747 por id', bloqueoDe({ id: 747, sku: 'lo-que-sea' }) !== null)
check('bloqueoDe() NO marca un producto sano', bloqueoDe({ id: 130, sku: '001011001' }) === null)

console.log('\n— Talla desde el título de Mercado Pago —')
const titulos = [
  ['Pollito (Talla 4)', '4'],
  ['Deadpool (Talla 4, Súper Acolchado)', '4'],
  ['Spider-Man Negro (Talla Bebé, Línea Eco)', 'Bebé'],
  ['Venom Negro (Talla S)', 'S'],
  ['Pedido Kustom (Mercado Pago)', null],
]
for (const [t, esperado] of titulos) {
  const got = tallaDesdeTitulo(t)
  check(`"${t}" → ${JSON.stringify(esperado)}`, got === esperado, `obtenido ${JSON.stringify(got)}`)
}
// La expresión ANTERIOR se tragaba la gama; se deja como evidencia de la regresión.
const vieja = 'Deadpool (Talla 4, Súper Acolchado)'.match(/^(.*?)\s*\(Talla\s*(.+?)\)\s*$/)
check('la expresión anterior devolvía la gama pegada a la talla', vieja?.[2] === '4, Súper Acolchado', JSON.stringify(vieja?.[2]))

console.log('\n— Camino de fallo: una orden PAGADA nunca se bloquea —')
// Se replica la lógica de createWooOrder sin tocar la red: por cada línea se
// resuelve; si falla, la línea va SIN ids, se apunta y la orden se crea igual.
async function simularOrden(items) {
  const sinEnlazar = []
  const lineItems = []
  for (const it of items) {
    const base = { name: it.title, quantity: it.quantity, sku: it.sku }
    let r
    try { r = await resolveMod.resolverProductoTalla(it.sku ?? '', it.talla) }
    catch (err) { r = { ok: false, motivo: `error resolviendo: ${err?.message}` } }
    if (!r.ok) { sinEnlazar.push({ sku: it.sku, title: it.title, talla: it.talla, motivo: r.motivo }); lineItems.push(base); continue }
    lineItems.push({ ...base, product_id: r.product_id, variation_id: r.variation_id })
  }
  const meta = sinEnlazar.length ? [{ key: '_kustom_ajuste_manual', value: sinEnlazar.map(l => l.motivo).join(' | ') }] : []
  return { creada: true, lineItems, sinEnlazar, meta }
}
const orden = await simularOrden([
  { sku: '001011001', talla: '4', title: 'Pollito (Talla 4)', quantity: 1 },
  { sku: '005001001', talla: '12', title: 'Vaquerito Woody (Talla 12)', quantity: 1 }, // no resuelve
  { sku: '001011001', talla: null, title: 'Pollito', quantity: 1 }, // sin talla
])
check('la orden SE CREA aunque haya líneas sin resolver', orden.creada === true)
check('las 3 líneas están en el pedido (no se pierde ninguna)', orden.lineItems.length === 3)
check('la línea que sí resolvió lleva product_id y variation_id', !!orden.lineItems[0].product_id && !!orden.lineItems[0].variation_id, `${orden.lineItems[0].product_id}/${orden.lineItems[0].variation_id}`)
check('la línea que no resolvió va SIN ids (Woo no le descuenta; se ajusta a mano)', !orden.lineItems[1].product_id && !orden.lineItems[1].variation_id)
check('quedan 2 líneas marcadas para ajuste manual', orden.sinEnlazar.length === 2, orden.sinEnlazar.map(l => `${l.sku}:${l.motivo}`).join(' · '))
check('la orden lleva la meta _kustom_ajuste_manual', orden.meta.some(m => m.key === '_kustom_ajuste_manual'))
check('una línea sin talla se reporta con ese motivo', /talla/i.test(orden.sinEnlazar[1].motivo), orden.sinEnlazar[1].motivo)

console.log('\n— Nunca se escribe regular_price = 0 —')
// Misma regla que /api/inventario/operaciones.
const num = v => Number(String(v ?? '').replace(/[^\d.-]/g, ''))
const aceptaPrecio = (valor) => {
  const reg = num(valor)
  return !(valor === null || valor === undefined || String(valor).trim() === '' || !Number.isFinite(reg) || reg <= 0)
}
for (const [valor, esperado] of [[0, false], ['0', false], ['', false], [null, false], [undefined, false], ['-100', false], ['146000', true], [146000, true]]) {
  check(`regular_price ${JSON.stringify(valor)} → ${esperado ? 'se escribe' : 'SE SALTA'}`, aceptaPrecio(valor) === esperado)
}

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exit(fails ? 1 : 0)
