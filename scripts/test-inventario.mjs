// Pruebas del MÓDULO DE INVENTARIO contra un dev server local (npm run dev +
// POSTGRES_URL + NUXT_INBOX_PASSWORD en .env). Ejercita la API tal como lo hace
// /admin/inventario. Con NUXT_INVENTORY_BACKEND=mock (default) NADA llega a Woo:
// las escrituras van a inventory_overrides y se limpian al final.
//
//   node scripts/test-inventario.mjs [baseUrl] [--keep]   (default http://localhost:3000)
//   node scripts/test-inventario.mjs cleanup               (borra overrides/cambios de prueba)
//
// Escenarios:
//   1. Estado: adaptador, simulación, conteos, snapshot.
//   2. Sincronización con Woo por tandas hasta pendientes = 0 (si hay credencial de lectura).
//   3. Tallas no numéricas: "-TBebé" existe, ordena PRIMERO y se parsea (Bebé, 0, 2, 4…).
//   4. Lista: búsqueda sin tildes, filtro por estado/línea/público, paginación, orden.
//   5. Escrituras en la variación Bebé (precio + oferta) y en una numérica (stock);
//      valor anterior/nuevo en la respuesta y filas en el registro de cambios.
//   6. Validaciones: precio no numérico, oferta ≥ precio, stock negativo, SKU inexistente.
//   7. Bulk: varias operaciones en una llamada; una inválida no frena las demás.
//   8. Filtro stock bajo/agotado tras poner stock 0.
//   9. Vista previa "aplicar a Woo": antes → después coherente; NO escribe.
//  10. Sin sesión → 401.
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const MODE = args.includes('cleanup') ? 'cleanup' : 'run'
const BASE = args.find(a => a.startsWith('http')) ?? 'http://localhost:3000'

function loadEnv() {
  const env = {}
  const raw = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim()
  }
  return env
}
const env = loadEnv()
const sql = env.POSTGRES_URL || env.DATABASE_URL ? neon(env.POSTGRES_URL || env.DATABASE_URL) : null

let fails = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) fails++ }

// SKUs de prueba: producto publicado con talla Bebé (Gato con Botas) y uno numérico.
const P_BEBE = '001010001'
const V_BEBE = `${P_BEBE}-TBebé`
const V_NUM = `${P_BEBE}-T4`
const V_NUM2 = `${P_BEBE}-T2`
const AUTOR = 'test-inventario'

async function cleanup() {
  if (!sql) { console.log('sin BD: nada que limpiar'); return }
  const skus = [V_BEBE, V_NUM, V_NUM2, `${P_BEBE}-T0`]
  await sql.query(`DELETE FROM inventory_overrides WHERE sku = ANY($1::text[])`, [skus])
  await sql.query(`DELETE FROM inventory_changes WHERE autor = $1 OR origen = 'prueba'`, [AUTOR])
  console.log('🧹 overrides y cambios de prueba borrados')
}
if (MODE === 'cleanup') { await cleanup(); process.exit(0) }

// ---------- sesión ----------
if (!env.NUXT_INBOX_PASSWORD) { console.error('❌ Falta NUXT_INBOX_PASSWORD en .env'); process.exit(1) }
const noAuth = await fetch(`${BASE}/api/inventario/estado`)
check('10. sin sesión → 401', noAuth.status === 401, `status ${noAuth.status}`)
const login = await fetch(`${BASE}/api/inbox/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.NUXT_INBOX_PASSWORD }) })
if (!login.ok) { console.error(`❌ login falló (${login.status})`); process.exit(1) }
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const api = async (path, opts = {}) => {
  const res = await fetch(`${BASE}/api/inventario${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', cookie },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const ops = (operaciones, origen = 'prueba') => api('/operaciones', { method: 'POST', body: { operaciones, origen, autor: AUTOR } })

await cleanup()

// ---------- 1. estado ----------
let { json: estado } = await api('/estado')
check('1. estado responde', estado.backend === 'mock' || estado.backend === 'woo', `backend=${estado.backend} simulación=${estado.simulation} origen=${estado.origen}`)
check('1. conteos coherentes', estado.productos > 0 && estado.publicados + estado.borradores === estado.productos, `${estado.productos} productos = ${estado.publicados} pub + ${estado.borradores} borr`)

// ---------- 2. sincronización ----------
if (env.WOO_API_URL && env.WOO_CONSUMER_KEY) {
  let last
  for (let i = 0; i < 40; i++) {
    last = (await api('/sincronizar', { method: 'POST', body: {} })).json
    if (last.error || !last.pendientes) break
  }
  check('2. sincronización termina sin pendientes', !last.error && last.pendientes === 0, last.error ? last.error : `total ${last.total}`)
  ;({ json: estado } = await api('/estado'))
  check('2. snapshot con datos de Woo', estado.origen === 'woo' && estado.snapshot_age_s < 600, `variaciones=${estado.variaciones} edad=${estado.snapshot_age_s}s`)
}
else console.log('⏭️  2. sin credencial de lectura de Woo: se usa catalogo.json')

// ---------- 3. tallas no numéricas ----------
const { json: gato } = await api(`/productos/${encodeURIComponent(P_BEBE)}`)
const tallas = (gato.product?.variations ?? []).map(v => v.attributes.find(a => a.name === 'Talla')?.option)
check('3. producto con talla Bebé', !!gato.product, `${gato.product?.name} · tallas ${tallas.join(', ')}`)
check('3. Bebé ordena primero, luego numéricas ascendentes', JSON.stringify(tallas) === JSON.stringify(['Bebé', '0', '2', '4']), JSON.stringify(tallas))
check('3. SKU de la variación Bebé = -TBebé (con tilde)', gato.product?.variations.some(v => v.sku === V_BEBE))
const { json: porVar } = await api(`/productos/${encodeURIComponent(V_BEBE)}`)
check('3. búsqueda por SKU de variación con tilde resuelve el padre', porVar.product?.sku === P_BEBE)

// ---------- 4. lista ----------
const { json: l1 } = await api('/productos?q=bebe&per_page=10')
check('4. búsqueda sin tildes ("bebe")', l1.total >= 1, `${l1.total} resultados`)
const { json: l2 } = await api('/productos?status=draft&per_page=100')
check('4. filtro borradores', l2.total === estado.borradores && l2.items.every(p => p.status === 'draft'), `${l2.total}`)
const { json: l3 } = await api('/productos?grupo=peluche-plus&publico=bebes')
check('4. filtro línea + público', l3.total >= 1 && l3.items.every(p => p.kustom.grupo === 'peluche-plus' && p.kustom.publicos.includes('bebes')), `${l3.total}`)
const { json: l4 } = await api('/productos?per_page=25&page=2')
check('4. paginación', l4.page === 2 && l4.items.length > 0 && l4.total_pages >= 2, `página ${l4.page}/${l4.total_pages}`)
const { json: l5 } = await api('/productos?orderby=price&order=desc&status=publish&per_page=5')
const precios = l5.items.map(p => Number(p.price))
check('4. orden por precio desc', precios.every((v, i) => i === 0 || v <= precios[i - 1]), precios.join(' ≥ '))

// ---------- 5. escrituras ----------
const before = gato.product.variations.find(v => v.sku === V_BEBE)
const w1 = await ops([{ op: 'price', sku: V_BEBE, regular_price: '135000', sale_price: '129000' }])
const r1 = w1.json.resultados?.[0]
check('5. precio + oferta en la talla Bebé', r1?.ok === true && r1.after.regular_price === '135000' && r1.after.sale_price === '129000' && r1.after.price === '129000', r1?.error ?? `${r1?.before.regular_price} → ${r1?.after.regular_price} / oferta ${r1?.after.sale_price}`)
check('5. valor anterior reportado', r1?.before?.regular_price === before.regular_price, `${r1?.before?.regular_price}`)
const w2 = await ops([{ op: 'stock', sku: V_NUM, stock_quantity: 3 }])
const r2 = w2.json.resultados?.[0]
check('5. stock en talla numérica activa gestión', r2?.ok && r2.after.manage_stock === true && r2.after.stock_quantity === 3 && r2.after.stock_status === 'instock', r2?.error)
const { json: after } = await api(`/productos/${encodeURIComponent(P_BEBE)}`)
const vb = after.product.variations.find(v => v.sku === V_BEBE)
check('5. relectura muestra el cambio persistido', vb.regular_price === '135000' && vb.sale_price === '129000')
check('5. precio del padre recalculado (mínimo de variaciones)', after.product.price === '129000', after.product.price)
const camposBebe = after.cambios.filter(c => c.sku === V_BEBE && c.autor === AUTOR).map(c => `${c.campo}:${c.anterior}→${c.nuevo}`)
check('5. registro de cambios con anterior/nuevo/origen/autor', camposBebe.length >= 2 && after.cambios.every(c => c.origen && c.backend), camposBebe.join(' · '))
const { json: cambios } = await api(`/cambios?sku=${encodeURIComponent(P_BEBE)}`)
check('5. /cambios filtra por SKU de padre', cambios.total >= 3 && cambios.items.every(c => c.sku.startsWith(P_BEBE)), `${cambios.total}`)

// ---------- 6. validaciones ----------
const w3 = await ops([
  { op: 'price', sku: V_NUM2, regular_price: 'abc', sale_price: '' },
  { op: 'price', sku: V_NUM2, regular_price: '100000', sale_price: '120000' },
  { op: 'stock', sku: V_NUM2, stock_quantity: -2 },
  { op: 'stock', sku: 'NOEXISTE-T4', stock_quantity: 1 },
])
const errs = w3.json.resultados?.map(r => r.ok ? 'OK' : r.error) ?? []
check('6. cuatro operaciones inválidas rechazadas con mensaje', w3.json.fallidas === 4 && errs.every(e => e !== 'OK'), errs.join(' | '))
const { json: sinTocar } = await api(`/productos/${encodeURIComponent(P_BEBE)}`)
check('6. la variación inválida no cambió', sinTocar.product.variations.find(v => v.sku === V_NUM2).regular_price === before.regular_price)

// ---------- 7. bulk ----------
const w4 = await ops([
  { op: 'stock', sku: V_NUM2, stock_quantity: 10 },
  { op: 'price', sku: `${P_BEBE}-T0`, regular_price: '131000', sale_price: '' },
  { op: 'stock', sku: 'NOEXISTE-T9', stock_quantity: 1 },
], 'masivo')
check('7. bulk: 2 ok + 1 fallida, sin frenar', w4.json.ok === 2 && w4.json.fallidas === 1, `ok=${w4.json.ok} fallidas=${w4.json.fallidas}`)

// ---------- 8. stock bajo / agotado ----------
await ops([{ op: 'stock', sku: V_NUM, stock_quantity: 0 }])
const { json: bajo } = await api('/productos?stock=bajo')
check('8. filtro "stock bajo o agotado" incluye el producto', bajo.items.some(p => p.sku === P_BEBE), `${bajo.total}`)
const { json: agot } = await api(`/productos/${encodeURIComponent(P_BEBE)}`)
check('8. talla con stock 0 queda outofstock', agot.product.variations.find(v => v.sku === V_NUM).stock_status === 'outofstock')
check('8. el padre sigue instock (otras tallas disponibles)', agot.product.stock_status === 'instock')

// ---------- 9. vista previa aplicar a Woo ----------
const { json: prev } = await api('/aplicar-woo', { method: 'POST', body: { preview: true } })
const fila = prev.filas?.find(f => f.sku === V_BEBE)
check('9. vista previa lista la sobreescritura Bebé con antes → después', prev.preview === true && fila && fila.antes.regular_price === before.regular_price && fila.despues.regular_price === '135000', fila ? `${fila.antes.regular_price} → ${fila.despues.regular_price}` : 'sin fila')
check('9. la vista previa no escribió (overrides siguen)', (await api('/estado')).json.overrides >= 3)

if (!KEEP) await cleanup()
else console.log('--keep: overrides de prueba conservados para revisar en /admin/inventario')
console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exit(fails ? 1 : 0)
