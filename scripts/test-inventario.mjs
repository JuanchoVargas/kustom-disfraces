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

// ---------- 11. operación masiva (vista previa) ----------
const { json: m1 } = await api('/masivo', { method: 'POST', body: { skus: [P_BEBE], precio: { modo: 'porcentaje', valor: 10, redondeo: 100 } } })
check('11. masivo +10 % sobre un producto: una fila por talla, todas con cambio', m1.total === 4 && m1.con_cambios === 4 && m1.errores === 0, `${m1.total} filas · ${m1.con_cambios} cambios`)
const fBebe = m1.filas?.find(f => f.sku === V_BEBE)
check('11. 135.000 + 10 % redondeado a 100 = 148.500', fBebe?.despues.regular_price === '148500' && fBebe?.ops.length === 1, `${fBebe?.antes.regular_price} → ${fBebe?.despues.regular_price}`)
const { json: m2 } = await api('/masivo', { method: 'POST', body: { skus: [P_BEBE], tallas: ['Bebé'], oferta: { modo: 'fijar', valor: 200000 } } })
check('11. filtro por talla Bebé + oferta ≥ precio → 1 fila con error, no se aplica', m2.total === 1 && m2.errores === 1 && m2.filas[0].sku === V_BEBE && /menor/.test(m2.filas[0].error), m2.filas?.[0]?.error)
const { json: m3 } = await api('/masivo', { method: 'POST', body: { skus: [P_BEBE], stock: { modo: 'gestionar', valor: 5 } } })
const t0 = m3.filas?.find(f => f.sku === `${P_BEBE}-T0`)
check('11. "activar gestión" con 5: talla sin gestionar pasa a 5, las ya gestionadas conservan su cantidad (T2=10, T4=0)', t0?.despues.manage_stock === true && t0?.despues.stock_quantity === 5 && m3.filas.find(f => f.sku === V_NUM2)?.despues.stock_quantity === 10 && m3.filas.find(f => f.sku === V_NUM)?.despues.stock_quantity === 0, JSON.stringify(t0?.despues))
const { json: m4 } = await api('/masivo', { method: 'POST', body: { filtros: { grupo: 'peluche-plus', publico: 'bebes' }, oferta: { modo: 'porcentaje', valor: 20 } } })
check('11. masivo sobre filtros (línea + público) alcanza varios productos', m4.productos >= 2 && m4.con_cambios >= 2, `${m4.productos} productos · ${m4.con_cambios} cambios`)
const { status: m5 } = await api('/masivo', { method: 'POST', body: { skus: [P_BEBE] } })
check('11. masivo sin operación → 400', m5 === 400)

// ---------- 12. exportar (xlsx / csv) y reimportar sin cambios ----------
const xres = await fetch(`${BASE}/api/inventario/exportar?q=gato`, { headers: { cookie } })
const xbuf = Buffer.from(await xres.arrayBuffer())
check('12. exportar .xlsx: content-type y firma zip', xres.status === 200 && /spreadsheetml/.test(xres.headers.get('content-type') ?? '') && xbuf[0] === 0x50 && xbuf[1] === 0x4B, `${xbuf.length} bytes · ${xres.headers.get('content-disposition')}`)
const upload = async (buf, name, type) => {
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type }), name)
  const res = await fetch(`${BASE}/api/inventario/importar`, { method: 'POST', headers: { cookie }, body: fd })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const { json: rt } = await upload(xbuf, 'inventario.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
check('12. el .xlsx exportado se reimporta: 4 filas, 0 cambios, 0 errores (ida y vuelta exacta)', rt.resumen?.total === 4 && rt.resumen.con_cambios === 0 && rt.resumen.errores === 0 && rt.columnas?.sku && rt.columnas.precio && rt.columnas.stock, JSON.stringify(rt.resumen))
const cres = await fetch(`${BASE}/api/inventario/exportar?q=gato&formato=csv`, { headers: { cookie } })
const cbuf = Buffer.from(await cres.arrayBuffer())
const ctext = cbuf.subarray(3).toString('utf8')
check('12. exportar .csv: BOM + encabezado con ";"', cres.status === 200 && cbuf[0] === 0xEF && cbuf[1] === 0xBB && cbuf[2] === 0xBF && ctext.split(/\r?\n/)[0].startsWith('SKU;Código;Producto;Talla'), ctext.split(/\r?\n/)[0])
const { json: rtc } = await upload(cbuf, 'inventario.csv', 'text/csv')
check('12. el .csv exportado se reimporta sin cambios', rtc.resumen?.total === 4 && rtc.resumen.con_cambios === 0 && rtc.resumen.errores === 0, JSON.stringify(rtc.resumen))

// ---------- 13. importar con cambios y errores, luego aplicar ----------
const csv = ['SKU;Precio normal;Precio rebajado;Stock', `${V_BEBE};140000;;7`, 'NOEXISTE-T1;100;;', `${V_NUM};abc;;`, `${V_NUM};1;;`, `${V_NUM2};;;`].join('\r\n')
const { json: imp } = await upload(Buffer.from(csv, 'utf8'), 'cambios.csv', 'text/csv')
check('13. importación: 1 con cambio, 2 con error (SKU inexistente, precio inválido), 1 repetido ignorado, 1 sin cambio', imp.resumen?.con_cambios === 1 && imp.resumen.errores === 3 && imp.ignoradas?.length === 1 && imp.resumen.sin_cambio === 1, JSON.stringify(imp.resumen))
const fi = imp.filas?.find(f => f.sku === V_BEBE)
check('13. la fila Bebé propone precio 140.000, oferta quitada y stock 7', fi?.despues.regular_price === '140000' && fi.despues.sale_price === '' && fi.despues.stock_quantity === 7 && fi.ops.length === 2, JSON.stringify(fi?.despues))
const opsImp = imp.filas.filter(f => f.cambia && !f.error).flatMap(f => f.ops)
const ap = await ops(opsImp, 'importacion')
check('13. aplicar la importación: 2 operaciones ok', ap.json.ok === 2 && ap.json.fallidas === 0, `ok=${ap.json.ok}`)
const { json: postImp } = await api(`/productos/${encodeURIComponent(P_BEBE)}`)
const vbi = postImp.product.variations.find(v => v.sku === V_BEBE)
check('13. relectura: 140.000, sin oferta, stock 7, origen "importacion" en el registro', vbi.regular_price === '140000' && vbi.sale_price === '' && vbi.stock_quantity === 7 && postImp.cambios.some(c => c.origen === 'importacion'))

// ---------- 14. lógica de agotado: sitio, bot y checkout (requiere NUXT_INVENTORY_PUBLIC_STOCK=on en el dev server) ----------
const { json: stock0 } = await api('/estado')
if (!stock0.public_stock) {
  console.log('⏭️  14. stock público desactivado (NUXT_INVENTORY_PUBLIC_STOCK≠on): se omite la lógica de agotado')
}
else {
  const SLUG = 'gato-con-botas'
  const WA_FROM = '570000000014'
  const waHook = text => ({
    object: 'whatsapp_business_account',
    entry: [{ id: '0', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      contacts: [{ profile: { name: 'Prueba Stock' }, wa_id: WA_FROM }],
      messages: [{ from: WA_FROM, id: `test.stock.${Date.now()}`, timestamp: String(Date.now() / 1000 | 0), type: 'text', text: { body: text } }],
    } }] }],
  })
  const botReply = async (text) => {
    await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(waHook(text)) })
    if (!sql) return ''
    const rows = await sql.query(`SELECT m.texto FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.canal = 'wa' AND c.external_id = $1 AND m.direccion = 'out' ORDER BY m.id DESC LIMIT 1`, [WA_FROM])
    return rows[0]?.texto ?? ''
  }
  const checkout = async (size, quantity) => {
    const res = await fetch(`${BASE}/api/checkout/mercadopago`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      items: [{ sku: P_BEBE, quantity, size }],
      buyer: { nombre: 'Prueba Stock', email: 'prueba@example.com', telefono: '3000000000', pais: 'Colombia', departamento: 'Bogotá', ciudad: 'Bogotá', localidad: 'Kennedy', barrio: 'Centro', direccion: 'Calle 1 # 2-3' },
    }) })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  }

  // a) talla 4 agotada (stock 0), las demás sin gestionar
  await ops([{ op: 'stock', sku: V_NUM, stock_quantity: 0 }])
  const { json: st1 } = await fetch(`${BASE}/api/stock`).then(r => r.json()).then(json => ({ json }))
  check('14a. /api/stock: talla 4 agotada, producto NO agotado', st1.enabled && !st1.agotados.includes(P_BEBE) && JSON.stringify(st1.tallas[P_BEBE]) === '["4"]', JSON.stringify(st1.tallas[P_BEBE]))
  const pdp = await fetch(`${BASE}/producto/${SLUG}`).then(r => r.text())
  // SSR: el SizeSelector pinta la talla 4 deshabilitada (clase "dis" + atributo disabled) y las demás no.
  const btn4 = pdp.match(/<button[^>]*>\s*4\s*<\/button>/)?.[0] ?? ''
  const btn2 = pdp.match(/<button[^>]*>\s*2\s*<\/button>/)?.[0] ?? ''
  check('14a. PDP: la talla 4 sale deshabilitada y la 2 no', pdp.includes('stock-agotado') && /\bdis\b/.test(btn4) && /disabled/.test(btn4) && !/disabled/.test(btn2), btn4.slice(0, 120))
  const bot4 = await botReply('gato con botas talla 4')
  check('14a. bot: "talla 4" del gato → ⚠️ no disponible (tallas restantes Bebé, 0, 2)', /Talla \*4\* no disponible/.test(bot4) && /Bebé, 0, 2/.test(bot4), bot4.split('\n').slice(0, 4).join(' | '))
  const co1 = await checkout('4', 1)
  check('14a. checkout: talla 4 agotada → 409 sin_stock', co1.status === 409 && co1.json?.data?.code === 'sin_stock' && co1.json.data.items?.[0]?.disponible === 0, `${co1.status} ${JSON.stringify(co1.json?.data)}`)
  const co2 = await checkout('2', 1)
  check('14a. checkout: talla 2 sin gestionar → pasa la validación de stock (no es 409)', co2.status !== 409, `status ${co2.status} (${co2.json?.data?.code ?? co2.json?.message ?? 'ok'})`)

  // b) talla 2 con 3 unidades: pedir 5 → 409 con disponible 3; pedir 2 → pasa
  await ops([{ op: 'stock', sku: V_NUM2, stock_quantity: 3 }])
  const co3 = await checkout('2', 5)
  check('14b. checkout: pedir 5 con 3 disponibles → 409 (disponible 3)', co3.status === 409 && co3.json?.data?.items?.[0]?.disponible === 3, `${co3.status}`)
  const co4 = await checkout('2', 2)
  check('14b. checkout: pedir 2 con 3 disponibles → pasa', co4.status !== 409, `status ${co4.status}`)

  // c) producto TOTALMENTE agotado: fuera del sitio y del bot
  await ops([{ op: 'stock', sku: V_BEBE, stock_quantity: 0 }, { op: 'stock', sku: `${P_BEBE}-T0`, stock_quantity: 0 }, { op: 'stock', sku: V_NUM2, stock_quantity: 0 }])
  const st2 = await fetch(`${BASE}/api/stock`).then(r => r.json())
  check('14c. /api/stock: producto agotado (4 tallas en 0)', st2.agotados.includes(P_BEBE) && st2.tallas[P_BEBE].length === 4)
  const pdp2 = await fetch(`${BASE}/producto/${SLUG}`)
  check('14c. la PDP del producto agotado responde 404 (fuera del catálogo)', pdp2.status === 404, `status ${pdp2.status}`)
  const plp = await fetch(`${BASE}/categoria/bebes`).then(r => r.text())
  check('14c. la PLP de bebés ya no lista el producto', !plp.includes(`/producto/${SLUG}"`))
  const botOut = await botReply('gato con botas')
  check('14c. bot: producto agotado → "No encontré ese disfraz"', /No encontré ese disfraz/.test(botOut), botOut.split('\n')[0])
  const { json: est2 } = await api('/estado')
  check('14c. estado del panel: 4 tallas agotadas en alertas', est2.agotadas >= 4 && est2.public_stock === true, `agotadas=${est2.agotadas} bajo=${est2.stock_bajo}`)

  // d) vuelve a haber stock → todo reaparece (invalidación inmediata tras la escritura)
  await ops([{ op: 'stock', sku: V_BEBE, stock_quantity: 8 }])
  const st3 = await fetch(`${BASE}/api/stock`).then(r => r.json())
  check('14d. con stock en Bebé el producto sale de agotados', !st3.agotados.includes(P_BEBE) && st3.tallas[P_BEBE].length === 3)
  const botBack = await botReply('gato con botas')
  check('14d. bot: vuelve a encontrarlo y solo lista la talla Bebé', /Gato con Botas/.test(botBack) && /Tallas: Bebé(\r?\n|$)/.test(botBack) && !/Tallas: Bebé, 0/.test(botBack), botBack.split('\n').slice(0, 3).join(' | '))

  // e) alerta al cruzar el umbral: 8 → 2 (≤ 5) genera aviso; 2 → 1 no repite
  const a1 = await ops([{ op: 'stock', sku: V_BEBE, stock_quantity: 2 }])
  check('14e. bajar de 8 a 2 dispara la alerta de stock bajo (1 talla)', a1.json.alerta?.avisadas === 1, JSON.stringify(a1.json.alerta))
  const a2 = await ops([{ op: 'stock', sku: V_BEBE, stock_quantity: 1 }])
  check('14e. bajar de 2 a 1 no repite la alerta', a2.json.alerta?.avisadas === 0, JSON.stringify(a2.json.alerta))
  if (sql) await sql.query(`DELETE FROM conversations WHERE canal = 'wa' AND external_id = $1`, [WA_FROM])
}

// ---------- 15. con el stock público APAGADO (config de producción: mock + auto) el sitio, el bot y el checkout NO cambian ----------
if (stock0.public_stock) {
  console.log('⏭️  15. stock público activo: la verificación "sitio intacto" se corre con el dev server sin NUXT_INVENTORY_PUBLIC_STOCK')
}
else {
  const SLUG = 'gato-con-botas'
  const WA_FROM = '570000000016'
  await ops([{ op: 'stock', sku: V_BEBE, stock_quantity: 0 }, { op: 'stock', sku: `${P_BEBE}-T0`, stock_quantity: 0 }, { op: 'stock', sku: V_NUM2, stock_quantity: 0 }, { op: 'stock', sku: V_NUM, stock_quantity: 0 }])
  const st = await fetch(`${BASE}/api/stock`).then(r => r.json())
  check('15. /api/stock: enabled=false y nada agotado aunque el mock tenga 4 tallas en 0', st.enabled === false && st.agotados.length === 0 && Object.keys(st.tallas).length === 0, JSON.stringify(st).slice(0, 80))
  const pdp = await fetch(`${BASE}/producto/${SLUG}`)
  const html = await pdp.text()
  const btn4 = html.match(/<button[^>]*>\s*4\s*<\/button>/)?.[0] ?? ''
  check('15. la PDP responde 200 y la talla 4 sigue habilitada', pdp.status === 200 && btn4 && !/disabled/.test(btn4), btn4.slice(0, 90))
  const plp = await fetch(`${BASE}/categoria/bebes`).then(r => r.text())
  check('15. la PLP de bebés sigue listando el producto', plp.includes(`/producto/${SLUG}"`))
  const hook = { object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Prueba Intacto' }, wa_id: WA_FROM }], messages: [{ from: WA_FROM, id: `test.intacto.${Date.now()}`, timestamp: String(Date.now() / 1000 | 0), type: 'text', text: { body: 'gato con botas talla 4' } }] } }] }] }
  await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(hook) })
  const bot = sql ? (await sql.query(`SELECT m.texto FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.canal = 'wa' AND c.external_id = $1 AND m.direccion = 'out' ORDER BY m.id DESC LIMIT 1`, [WA_FROM]))[0]?.texto ?? '' : ''
  check('15. el bot sigue ofreciendo el producto con todas sus tallas y la 4 disponible', /Gato con Botas/.test(bot) && /Tallas: Bebé, 0, 2, 4/.test(bot) && /✅ Talla \*4\* disponible/.test(bot), bot.split('\n').slice(0, 4).join(' | '))
  const co = await fetch(`${BASE}/api/checkout/mercadopago`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ sku: P_BEBE, quantity: 1, size: '4' }], buyer: { nombre: 'Prueba Intacto', email: 'prueba@example.com', telefono: '3000000000', pais: 'Colombia', departamento: 'Bogotá', ciudad: 'Bogotá', localidad: 'Kennedy', barrio: 'Centro', direccion: 'Calle 1 # 2-3' } }) })
  check('15. el checkout no bloquea por stock (no es 409)', co.status !== 409, `status ${co.status}`)
  const { json: est } = await api('/estado')
  check('15. el panel sí ve las 4 tallas agotadas (la simulación vive solo en el panel)', est.agotadas >= 4 && est.public_stock === false && est.simulation === true, `agotadas=${est.agotadas} public_stock=${est.public_stock}`)
  if (sql) await sql.query(`DELETE FROM conversations WHERE canal = 'wa' AND external_id = $1`, [WA_FROM])
}

if (!KEEP) await cleanup()
else console.log('--keep: overrides de prueba conservados para revisar en /admin/inventario')
console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exit(fails ? 1 : 0)
