// Verifica SIN RED ni BD el precio anclado del webhook de Mercado Pago
// (server/utils/mpAnclaje.ts) con pagos con la forma real de MP.
//
//   node scripts/test-anclaje-mp.mjs
//
// Casos: kustom_lineas válido → precio anclado; sin metadata → mismas líneas que el
// código anterior (réplica literal, línea por línea); metadata malformada →
// comportamiento anterior + ajuste manual; suma ≠ transaction_amount → ajuste
// manual; cantidades > 1 y dos tallas del mismo producto; talla que no casa; y que
// se compara contra transaction_amount y NO contra total_paid_amount (cuotas).
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({ public: {} })
// inventoryResolve importa el snapshot, que importa woo.ts (defineCachedFunction es global de Nitro): se stubea sin red.
globalThis.defineCachedFunction = fn => fn
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const A = await jiti.import('../server/utils/mpAnclaje.ts')
const { tallaDesdeTitulo } = await jiti.import('../server/utils/inventoryResolve.ts')

let fallos = 0
const ok = (cond, msg, extra = '') => { if (cond) console.log(`✅ ${msg}`); else { fallos++; console.error(`❌ ${msg}${extra ? ` — ${extra}` : ''}`) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Precios "reales" del servidor HOY (p. ej. la promoción ya terminó: Batman vuelve a 159000).
const priceMap = new Map([
  ['001001008', { price: 159000, name: 'Batman', slug: 'batman' }],
  ['001008003', { price: 110000, name: 'Batichica', slug: 'batichica' }],
  ['001010001', { price: 129000, name: 'Gato con Botas', slug: 'gato-con-botas' }],
])

/** Réplica LITERAL de cómo el webhook construía las líneas antes del anclaje (master). */
function lineasMaster(items) {
  return items.map((it) => {
    const sku = it.id ? String(it.id) : undefined
    const real = sku ? priceMap?.get(sku) : undefined
    const paidPrice = Number(it.unit_price) || 0
    const title = String(it.title ?? 'Producto')
    const m = title.match(/^(.*?)\s*\(Talla\s*(.+?)\)\s*$/)
    const talla = tallaDesdeTitulo(title)
    return {
      sku,
      title,
      name: real?.name ?? (m ? m[1] : title),
      talla: talla ?? '—',
      slug: real?.slug || undefined,
      quantity: Math.max(1, Math.trunc(Number(it.quantity) || 1)),
      unitPrice: real?.price ?? paidPrice,
    }
  })
}
const sinAnclada = l => l.map(({ anclada, ...r }) => r)

/** Pago con la forma real de MP (campos relevantes). total_paid_amount incluye la financiación. */
function pago({ items, metadata, transaction_amount, total_paid_amount }) {
  return {
    id: 179091023606,
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount,
    transaction_details: { total_paid_amount: total_paid_amount ?? transaction_amount, installment_amount: 0 },
    installments: 3,
    payer: { email: 'x@x' },
    additional_info: { items },
    metadata,
  }
}
const item = (id, title, quantity, unit_price) => ({ id, title, quantity: String(quantity), unit_price: String(unit_price) })

// ---------- 1) kustom_lineas válido → precio anclado ----------
{
  const items = [item('001001008', 'Batman (Talla 8)', 1, 95400), item('001010001', 'Gato con Botas (Talla 4)', 1, 129000)]
  const md = { nombre: 'x', kustom_lineas: JSON.stringify([['001001008', '8', 1, 95400, 'batman-day-2026'], ['001010001', '4', 1, 129000, '']]), kustom_total: 224400 }
  const p = pago({ items, metadata: md, transaction_amount: 224400, total_paid_amount: 236000 })
  const anc = A.leerAnclaje(p.metadata)
  const r = A.construirLineas(p.additional_info.items, priceMap, anc, tallaDesdeTitulo)
  ok(anc.estado === 'ok' && anc.lineas.length === 2, '1. metadata válida: se leen 2 líneas ancladas')
  ok(r.lineas[0].unitPrice === 95400 && r.lineas[0].anclada && r.lineas[1].unitPrice === 129000, '1. usa el precio ANCLADO (95400) aunque hoy el real sea 159000', JSON.stringify(r.lineas.map(l => l.unitPrice)))
  ok(r.ajustes.length === 0, '1. sin ajuste manual')
  ok(A.verificarMontos(r.lineas, p.transaction_amount) === null, '1. la suma anclada coincide con transaction_amount')
  ok(A.verificarMontos(r.lineas, p.transaction_details.total_paid_amount) !== null, '1. (control) contra total_paid_amount NO coincidiría: por eso el webhook usa transaction_amount')
  const src = readFileSync(`${root}server/api/webhooks/mercadopago.post.ts`, 'utf8')
  ok(/verificarMontos\(orderItems, payment\.transaction_amount\)/.test(src) && !/total_paid_amount/.test(src), '1. el webhook compara contra payment.transaction_amount y nunca contra total_paid_amount')
}

// ---------- 2) sin metadata → idéntico al código anterior, línea por línea ----------
{
  const items = [item('001001008', 'Batman (Talla 8)', 2, 159000), item('001008003', 'Batichica (Talla 10, Vestido)', 1, 110000), item('X-NO-EXISTE', 'Cosa rara', 1, 5000), item(undefined, 'Sin id', 1, 7000)]
  for (const [nombre, md] of [['sin metadata', undefined], ['metadata solo del comprador', { nombre: 'x', direccion: 'y' }], ['kustom_lineas vacío', { kustom_lineas: '' }]]) {
    const anc = A.leerAnclaje(md)
    const r = A.construirLineas(items, priceMap, anc, tallaDesdeTitulo)
    ok(anc.estado === 'ausente', `2. ${nombre}: anclaje ausente`)
    ok(eq(sinAnclada(r.lineas), lineasMaster(items)), `2. ${nombre}: mismas líneas que master (${items.length} líneas, incluidas sin SKU y no vendible)`, JSON.stringify(sinAnclada(r.lineas)))
    ok(r.ajustes.length === 0 && A.verificarMontos(r.lineas, 999) === null, `2. ${nombre}: sin ajuste manual ni verificación de montos`)
    ok(r.lineas.every(l => !l.anclada), `2. ${nombre}: ninguna línea anclada`)
  }
}

// ---------- 3) metadata malformada → comportamiento anterior + ajuste manual ----------
{
  const items = [item('001001008', 'Batman (Talla 8)', 1, 95400)]
  const casos = [
    ['no es JSON', { kustom_lineas: '[[001001008' }],
    ['es un objeto, no lista', { kustom_lineas: '{"a":1}' }],
    ['lista vacía', { kustom_lineas: '[]' }],
    ['línea sin precio', { kustom_lineas: JSON.stringify([['001001008', '8', 1, null, '']]) }],
    ['precio negativo', { kustom_lineas: JSON.stringify([['001001008', '8', 1, -5, '']]) }],
    ['línea que no es lista', { kustom_lineas: JSON.stringify(['001001008']) }],
    ['número en vez de texto', { kustom_lineas: 42 }],
  ]
  for (const [nombre, md] of casos) {
    let anc, r
    try { anc = A.leerAnclaje(md); r = A.construirLineas(items, priceMap, anc, tallaDesdeTitulo) } catch (e) { fallos++; console.error(`❌ 3. ${nombre}: lanzó ${e.message}`); continue }
    ok(anc.estado === 'invalida', `3. ${nombre}: anclaje inválido (${anc.motivo ?? ''})`)
    ok(eq(sinAnclada(r.lineas), lineasMaster(items)), `3. ${nombre}: líneas como master (precio real 159000)`)
    ok(r.ajustes.length === 1 && /ilegible/.test(r.ajustes[0]), `3. ${nombre}: motivo de ajuste manual`)
  }
}

// ---------- 4) suma distinta de transaction_amount → ajuste manual ----------
{
  const items = [item('001001008', 'Batman (Talla 8)', 1, 95400)]
  const md = { kustom_lineas: JSON.stringify([['001001008', '8', 1, 95400, 'batman-day-2026']]) }
  const r = A.construirLineas(items, priceMap, A.leerAnclaje(md), tallaDesdeTitulo)
  const m = A.verificarMontos(r.lineas, 100000)
  ok(r.lineas[0].unitPrice === 95400 && typeof m === 'string' && /95400/.test(m) && /100000/.test(m), '4. suma anclada 95400 ≠ cobrado 100000 → se respeta el anclado y hay motivo de ajuste', m ?? '')
  ok(A.verificarMontos(r.lineas, '95400') === null, '4. transaction_amount como texto también cuadra')
}

// ---------- 5) cantidades > 1 y dos tallas del mismo producto ----------
{
  const items = [item('001001008', 'Batman (Talla 8)', 2, 95400), item('001001008', 'Batman (Talla 12)', 3, 95400), item('001008003', 'Batichica (Talla 10)', 1, 66000)]
  const md = { kustom_lineas: JSON.stringify([['001001008', '8', 2, 95400, 'batman-day-2026'], ['001001008', '12', 3, 95400, 'batman-day-2026'], ['001008003', '10', 1, 66000, 'batman-day-2026']]) }
  const total = 2 * 95400 + 3 * 95400 + 66000
  const r = A.construirLineas(items, priceMap, A.leerAnclaje(md), tallaDesdeTitulo)
  ok(r.lineas.map(l => [l.talla, l.quantity, l.unitPrice]).every(([t, q, u], i) => [['8', 2, 95400], ['12', 3, 95400], ['10', 1, 66000]][i].every((v, j) => v === [t, q, u][j])), '5. dos tallas del mismo SKU y cantidades 2 y 3: cada línea con su talla, cantidad y precio anclado', JSON.stringify(r.lineas.map(l => [l.talla, l.quantity, l.unitPrice])))
  ok(A.verificarMontos(r.lineas, total) === null && r.ajustes.length === 0, `5. la suma (${total}) coincide y no hay ajuste`)
  // talla que no casa con varias líneas del mismo SKU: no adivina → ajuste manual, precio real
  const r2 = A.construirLineas([item('001001008', 'Batman (Talla 6)', 1, 95400)], priceMap, A.leerAnclaje(md), tallaDesdeTitulo)
  ok(!r2.lineas[0].anclada && r2.lineas[0].unitPrice === 159000 && r2.ajustes.length === 1, '5. talla 6 no anclada con dos tallas ancladas del mismo SKU: no adivina, recalcula y marca ajuste')
  // una sola línea del SKU y el título viene sin talla: cae a esa línea
  const r3 = A.construirLineas([item('001008003', 'Batichica', 1, 66000)], priceMap, A.leerAnclaje(md), tallaDesdeTitulo)
  ok(r3.lineas[0].anclada && r3.lineas[0].unitPrice === 66000 && r3.ajustes.length === 0, '5. título sin talla con una sola línea anclada de ese SKU: usa esa línea')
}

// ---------- 6) nada lanza ----------
{
  const raros = [null, undefined, 'texto', 7, [], { kustom_lineas: { a: 1 } }, { kustom_lineas: [[1, 2, 3]] }]
  let lanzo = 0
  for (const md of raros) { try { const a = A.leerAnclaje(md); A.construirLineas([item('001001008', 'Batman (Talla 8)', 1, 1)], priceMap, a, tallaDesdeTitulo); A.verificarMontos([], undefined) } catch { lanzo++ } }
  ok(lanzo === 0, `6. ninguna metadata rara hace lanzar (${raros.length} formas)`)
  ok(A.verificarMontos([], NaN) === null && A.verificarMontos([{ anclada: true, unitPrice: 10, quantity: 1 }], NaN) !== null, '6. transaction_amount ausente con líneas ancladas → ajuste manual, sin lanzar')
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto')
process.exit(fallos ? 1 : 0)
