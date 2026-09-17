// RELEER WOO ANTES DE ESCRIBIR (capa 1 contra el stock inflado).
//
//   node scripts/test-releer-woo.mjs
//
// El panel muestra el snapshot y Woo descuenta cada venta sin avisarle. Aquí se ejercita
// el adaptador woo REAL (server/utils/inventoryWoo.ts) con un WooCommerce FALSO en
// memoria ($fetch simulado: no hay red ni llaves) y el snapshot y el registro de cambios
// REALES. Por eso escribe en Postgres y exige la base de PRUEBAS (scripts/lib/guard-bd.mjs);
// usa SKU ficticios TEST-RELEER-* y los limpia. Como quien escribe es este proceso, no
// hace falta tener `npm run dev:test` levantado.
import { fileURLToPath } from 'node:url'
import { sqlDePruebas } from './lib/guard-bd.mjs'

const { sql, url, endpoint } = await sqlDePruebas()
console.log(`🧪 base de pruebas OK — endpoint ${endpoint}`)
process.env.POSTGRES_URL = url
delete process.env.DATABASE_URL

// ───────── WooCommerce falso ─────────
const PADRE = 990001
const SKU = 'TEST-RELEER-1'
const woo = new Map() // id de variación → variación "en Woo"
const llamadas = { lecturas: 0, escrituras: [] }
let wooCaido = false
const variacion = (id, talla, qty) => ({ id, sku: `${SKU}-T${talla}`, status: 'publish', price: '100000', regular_price: '100000', sale_price: '', manage_stock: true, stock_quantity: qty, stock_status: qty > 0 ? 'instock' : 'outofstock', attributes: [{ id: 1, name: 'Talla', option: String(talla) }] })
const aplicar = (id, body) => {
  const v = { ...woo.get(id), ...body }
  if (v.manage_stock === false) v.stock_quantity = null
  else v.stock_status = (v.stock_quantity ?? 0) > 0 ? 'instock' : 'outofstock'
  if ('regular_price' in body) v.price = body.sale_price || body.regular_price
  woo.set(id, v)
  return v
}
globalThis.$fetch = async (urlPedida, opts = {}) => {
  const path = String(urlPedida).split('/wp-json/wc/v3')[1] ?? ''
  const metodo = opts.method ?? 'GET'
  if (wooCaido) throw new Error(`[${metodo}] "${urlPedida}?consumer_key=ck_falsa": 503 Service Unavailable`)
  let m
  if (metodo === 'GET' && path === `/products/${PADRE}/variations`) { llamadas.lecturas++; return [...woo.values()].map(v => ({ ...v })) }
  if (metodo === 'GET' && (m = path.match(new RegExp(`^/products/${PADRE}/variations/(\\d+)$`)))) { llamadas.lecturas++; const v = woo.get(Number(m[1])); if (!v) throw new Error('404 Not Found'); return { ...v } }
  if (metodo === 'POST' && path === `/products/${PADRE}/variations/batch`) { llamadas.escrituras.push(...opts.body.update.map(u => ({ ...u }))); return { update: opts.body.update.map(({ id, ...body }) => ({ ...aplicar(id, body) })) } }
  if (metodo === 'PUT' && (m = path.match(new RegExp(`^/products/${PADRE}/variations/(\\d+)$`)))) { llamadas.escrituras.push({ id: Number(m[1]), ...opts.body }); return { ...aplicar(Number(m[1]), opts.body) } }
  throw new Error(`Woo falso: ruta no prevista ${metodo} ${path}`)
}

const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({ public: {}, wooBaseUrl: 'https://woo.falso.test', wooConsumerKey: 'ck_falsa', wooConsumerSecret: 'cs_falsa', wooWriteConsumerKey: 'ck_falsa_w', wooWriteConsumerSecret: 'cs_falsa_w', inventoryWooOnlyDrafts: 'true', inventoryWooAllow: '', inventoryStockBajo: 5 })
globalThis.defineCachedFunction = fn => fn
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const W = await jiti.import('../server/utils/inventoryWoo.ts')
const Snap = await jiti.import('../server/utils/inventorySnapshot.ts')
await (await jiti.import('../server/utils/db.ts')).ensureSchema()

let fails = 0
const ok = (c, t, d = '') => { console.log(`${c ? '✅' : '❌'} ${t}${d ? ` — ${d}` : ''}`); if (!c) fails++ }
const limpiar = async () => {
  await sql.query(`DELETE FROM inventory_snapshot WHERE sku LIKE 'TEST-RELEER-%'`)
  await sql.query(`DELETE FROM inventory_changes WHERE sku LIKE 'TEST-RELEER-%'`)
}
/** Deja Woo y el snapshot IGUALES (el panel recién sincronizado): T2, T4 y T6 con 5 unidades. */
const sembrar = async () => {
  await limpiar()
  woo.clear(); llamadas.lecturas = 0; llamadas.escrituras = []; wooCaido = false
  for (const [id, talla] of [[990012, 2], [990014, 4], [990016, 6]]) woo.set(id, variacion(id, talla, 5))
  await Snap.snapshotUpsert([{ id: PADRE, sku: SKU, name: 'Producto de prueba (releer)', status: 'draft', type: 'variable', price: '100000', origen: 'woo', fetched_at: new Date().toISOString(), attributes: [], images: [], variations: [...woo.values()].map(v => ({ ...v, image: null })) }])
}
const enSnapshot = async talla => (await Snap.snapshotGet(SKU))?.variations.find(v => v.sku === `${SKU}-T${talla}`)
const cambios = async () => (await sql.query(`SELECT sku, campo, anterior, nuevo FROM inventory_changes WHERE sku LIKE 'TEST-RELEER-%' ORDER BY id`)).map(c => `${c.sku.split('-T').pop()} ${c.campo} ${c.anterior}→${c.nuevo}`)
const ctx = { origen: 'panel', autor: 'test-releer' }
const store = W.createWooStore()
const orig = { warn: console.warn, error: console.error }

try {
  // ───────── pura ─────────
  const base = { manage_stock: true, stock_quantity: 5, stock_status: 'instock', regular_price: '100000', sale_price: '' }
  ok(W.conflictoConWoo({ manage_stock: true, stock_quantity: 5 }, base, { ...base }) === null, '0. conflictoConWoo: Woo igual al panel → sin conflicto')
  ok(/ahora hay 4 unidades y el panel mostraba 5 unidades/.test(W.conflictoConWoo({ manage_stock: true, stock_quantity: 5 }, base, { ...base, stock_quantity: 4 }) ?? ''), '0. conflictoConWoo: una venta (5→4) → rechazo con los dos números')
  ok(W.conflictoConWoo({ regular_price: '120000', sale_price: '' }, base, { ...base, stock_quantity: 4 }) === null, '0. conflictoConWoo: corregir el PRECIO no se rechaza porque una venta haya movido el stock')
  ok(/el precio cambió en Woo/.test(W.conflictoConWoo({ regular_price: '120000', sale_price: '' }, base, { ...base, regular_price: '110000' }) ?? ''), '0. conflictoConWoo: precio cambiado en Woo → rechaza la escritura de precio')
  ok(/sin gestionar/.test(W.conflictoConWoo({ manage_stock: true, stock_quantity: 5 }, base, { ...base, manage_stock: false, stock_quantity: null }) ?? ''), '0. conflictoConWoo: alguien quitó la gestión en wp-admin → rechaza')

  // ───────── 1. nada cambió en Woo → escribe ─────────
  await sembrar()
  let r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 7, manage_stock: true }], ctx)
  ok(r[0].ok && woo.get(990012).stock_quantity === 7 && (await enSnapshot(2)).stock_quantity === 7, '1. Woo sin cambios → se escribe (5→7) en Woo y en el snapshot', r[0].error)
  ok(llamadas.lecturas === 1 && llamadas.escrituras.length === 1, '1. una lectura previa por producto y una escritura', `lecturas=${llamadas.lecturas} escrituras=${llamadas.escrituras.length}`)

  // ───────── 2. EL CASO: venta en Woo, la encargada "corrige" con el dato viejo ─────────
  await sembrar()
  woo.get(990012).stock_quantity = 4 // una venta web: Woo descontó, el snapshot sigue en 5
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 5, manage_stock: true }], ctx)
  ok(!r[0].ok && /ahora hay 4 unidades y el panel mostraba 5 unidades/.test(r[0].error) && /NO se escribió/.test(r[0].error), '2. venta en Woo (4) y el panel en 5 → escribir 5 se RECHAZA con un mensaje claro', r[0].error)
  ok(woo.get(990012).stock_quantity === 4 && llamadas.escrituras.length === 0, '2. Woo se queda en 4: el stock NO se infla (ninguna escritura enviada)')
  ok((await enSnapshot(2)).stock_quantity === 4, '2. el snapshot queda al día (4): al recargar, el panel ya muestra lo real')
  ok((await cambios()).length === 0, '2. un rechazo no deja filas en inventory_changes')
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 9, manage_stock: true }], ctx)
  ok(r[0].ok && woo.get(990012).stock_quantity === 9 && (await cambios()).join('|') === '2 stock_quantity 4→9', '2. al guardar de nuevo, ya con el dato fresco, se escribe y el registro dice 4→9 (no 5→9)', (await cambios()).join('|'))

  // ───────── 2b. EL SEGUNDO CLIC: la pantalla sigue vieja pero el snapshot ya se puso al día ─────────
  await sembrar()
  woo.get(990012).stock_quantity = 4
  const visto = { manage_stock: true, stock_quantity: 5 } // lo que la fila MOSTRABA
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 5, manage_stock: true, esperado: visto }], ctx)
  ok(!r[0].ok && r[0].conflicto === true, '2b. primer intento → rechazado y marcado `conflicto` (el panel recarga la fila y descarta el borrador)')
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 5, manage_stock: true, esperado: visto }], ctx)
  ok(!r[0].ok && r[0].conflicto === true && woo.get(990012).stock_quantity === 4 && llamadas.escrituras.length === 0, '2b. SEGUNDO clic con la pantalla vieja (esperado 5, Woo 4) → se rechaza OTRA VEZ aunque el snapshot ya diga 4', r[0].error)
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 6, manage_stock: true, esperado: { manage_stock: true, stock_quantity: 4 } }], ctx)
  ok(r[0].ok && woo.get(990012).stock_quantity === 6, '2b. con la fila ya recargada (esperado 4) → se escribe', r[0].error)

  // ───────── 3. lote mixto ─────────
  await sembrar()
  woo.get(990014).stock_quantity = 3
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 8, manage_stock: true }, { op: 'stock', sku: `${SKU}-T4`, stock_quantity: 8, manage_stock: true }, { op: 'stock', sku: `${SKU}-T6`, stock_quantity: 0, manage_stock: true }], ctx)
  ok(r[0].ok && !r[1].ok && r[2].ok && woo.get(990012).stock_quantity === 8 && woo.get(990014).stock_quantity === 3 && woo.get(990016).stock_quantity === 0, '3. lote mixto: la talla que cambió se rechaza y las demás SÍ se escriben', r.map(x => x.ok ? 'ok' : 'rechazada').join(','))
  ok(llamadas.lecturas === 1 && llamadas.escrituras.map(e => e.id).join(',') === '990012,990016', '3. sigue siendo UNA lectura por producto; la rechazada no viaja a Woo')

  // ───────── 4. precio con stock movido por una venta ─────────
  await sembrar()
  woo.get(990012).stock_quantity = 2
  r = await store.bulkUpdate([{ op: 'price', sku: `${SKU}-T2`, regular_price: '120000', sale_price: null }], ctx)
  const s4 = await enSnapshot(2)
  ok(r[0].ok && woo.get(990012).regular_price === '120000' && woo.get(990012).stock_quantity === 2 && s4.regular_price === '120000' && s4.stock_quantity === 2, '4. cambio de PRECIO con una venta de por medio → se escribe, el stock de Woo no se toca y el snapshot recoge el 2', r[0].error)
  ok(!('stock_quantity' in llamadas.escrituras[0]) && !('manage_stock' in llamadas.escrituras[0]), '4. la escritura de precio no lleva campos de stock')

  // ───────── 5. Woo no responde ─────────
  await sembrar()
  wooCaido = true; console.warn = console.error = () => {}
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 6, manage_stock: true }], ctx)
  Object.assign(console, orig); wooCaido = false
  ok(!r[0].ok && /no se pudo leer el estado actual en Woo/.test(r[0].error) && llamadas.escrituras.length === 0 && !/ck_falsa/.test(r[0].error), '5. si no se puede leer Woo NO se escribe a ciegas (y el error no filtra la llave)', r[0].error)

  // ───────── 6. variación borrada en Woo ─────────
  await sembrar()
  woo.delete(990016)
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T6`, stock_quantity: 6, manage_stock: true }], ctx)
  ok(!r[0].ok && /ya no existe en Woo/.test(r[0].error) && llamadas.escrituras.length === 0, '6. variación que ya no existe en Woo → rechazo, sin escribir', r[0].error)

  // ───────── 7. escritura simple (la de una celda del panel) ─────────
  await sembrar()
  woo.get(990014).stock_quantity = 1
  let r7 = await store.updateVariationStock(`${SKU}-T4`, 5, ctx)
  ok(!r7.ok && /ahora hay 1 unidad y el panel mostraba 5 unidades/.test(r7.error) && woo.get(990014).stock_quantity === 1 && (await enSnapshot(4)).stock_quantity === 1 && llamadas.escrituras.length === 0, '7. escritura SIMPLE: mismo rechazo, Woo intacto y snapshot al día', r7.error)
  r7 = await store.updateVariationStock(`${SKU}-T6`, 3, ctx)
  ok(r7.ok && woo.get(990016).stock_quantity === 3, '7. escritura SIMPLE sin cambios en Woo → escribe', r7.error)

  // ───────── 8. restaurar un respaldo: absoluto a propósito ─────────
  await sembrar()
  woo.get(990012).stock_quantity = 1 // snapshot viejo (5) respecto a Woo (1)
  const r8 = await W.restaurarStockWoo([{ sku: `${SKU}-T2`, manage_stock: false, stock_quantity: null, stock_status: 'instock' }], { origen: 'script', autor: 'test-releer' })
  ok(r8[0].ok && woo.get(990012).manage_stock === false && llamadas.lecturas === 0, '8. restaurarStockWoo NO relee ni rechaza: volver a la foto es absoluto (lo calcula restaurar-woo.mjs contra Woo en vivo)', r8[0].error)

  // ───────── 9. la guarda sigue yendo primero ─────────
  await sembrar()
  const p = await Snap.snapshotGet(SKU); await Snap.snapshotUpsert([{ ...p, status: 'publish' }])
  r = await store.bulkUpdate([{ op: 'stock', sku: `${SKU}-T2`, stock_quantity: 6, manage_stock: true }], ctx)
  ok(!r[0].ok && /^bloqueado/.test(r[0].error) && llamadas.lecturas === 0 && llamadas.escrituras.length === 0, '9. un publicado fuera de la lista se bloquea ANTES de leer o escribir nada en Woo', r[0].error)
}
finally {
  Object.assign(console, orig)
  await limpiar()
}

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exitCode = fails ? 1 : 0
