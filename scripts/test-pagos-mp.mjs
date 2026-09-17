// PAGOS DE MERCADO PAGO — candado por pago (pagos_mp) y enlace de líneas en Woo.
//
//   node scripts/test-pagos-mp.mjs
//
// Llama a procesarPagoMp() DIRECTAMENTE (no por HTTP) con dependencias falsas: nada de
// Mercado Pago, WooCommerce ni correo. Lo único real es la tabla `pagos_mp`, y por eso
// ESCRIBE en Postgres: exige la base de PRUEBAS (scripts/lib/guard-bd.mjs: endpoint
// distinto al de producción + marcador kustom_bd_pruebas). Como aquí quien escribe es
// este proceso y no el servidor, no hace falta tener `npm run dev:test` levantado.
//
// Casos: carrera → una sola orden · creada → duplicate · procesando reciente → 409 ·
// fallida → se retoma · procesando vieja → se retoma · pending → sin fila ·
// sin BD → 503 · crearOrden lanza → fallida + 503. Y extras (segunda barrera, ajuste
// manual posterior, consulta a MP caída, forma de la línea que se envía a Woo).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sqlDePruebas } from './lib/guard-bd.mjs'

const { sql, url, endpoint } = await sqlDePruebas()
console.log(`🧪 base de pruebas OK — endpoint ${endpoint}`)
// El util lee la base de process.env: se fija la de PRUEBAS antes de importarlo.
process.env.POSTGRES_URL = url
delete process.env.DATABASE_URL

const root = fileURLToPath(new URL('..', import.meta.url))
const leer = rel => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
globalThis.useRuntimeConfig = () => ({ public: {} })
globalThis.defineCachedFunction = fn => fn
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const { procesarPagoMp } = await jiti.import('../server/utils/procesarPagoMp.ts')
const { PAGO_PROCESANDO_VIEJO_MIN } = await jiti.import('../server/utils/pagosMp.ts')
// La tabla la crea la migración real del servidor (mismo camino que en producción).
await (await jiti.import('../server/utils/db.ts')).ensureSchema()

let fails = 0
const check = (titulo, ok, detalle = '') => { console.log(`${ok ? '✅' : '❌'} ${titulo}${detalle ? ` — ${detalle}` : ''}`); if (!ok) fails++ }
const esperar = ms => new Promise(r => setTimeout(r, ms))

const PREFIJO = `test-pagosmp-${Date.now()}`
let serie = 0
const nuevoId = () => `${PREFIJO}-${++serie}`
const fila = async id => (await sql.query(`SELECT estado, order_id, intentos FROM pagos_mp WHERE payment_id = $1`, [id]))[0] ?? null
const limpiar = () => sql.query(`DELETE FROM pagos_mp WHERE payment_id LIKE 'test-pagosmp-%'`)

// Los logs del util se capturan: no ensucian la salida y se revisa que no lleven datos del comprador.
const CORREO_FALSO = 'comprador.falso@example.com'
const capturado = []
const orig = { info: console.info, warn: console.warn, error: console.error }
const silenciar = () => { for (const k of Object.keys(orig)) console[k] = (...a) => capturado.push(a.map(String).join(' ')) }
const restaurar = () => Object.assign(console, orig)

/** Dependencias falsas con contadores. `opciones` cambia el comportamiento por caso. */
function dobles(opciones = {}) {
  const llamadas = { consultarPago: 0, buscarOrden: 0, crearOrden: 0, marcarAjuste: [], correos: [] }
  let siguienteOrden = 9000
  const deps = {
    consultarPago: async (id) => {
      llamadas.consultarPago++
      if (opciones.mpCaido) throw new Error('MP 500')
      return { id, status: opciones.status ?? 'approved', status_detail: 'accredited', transaction_amount: 100000, payer: { email: CORREO_FALSO, first_name: 'Nombre', last_name: 'Falso' } }
    },
    buscarOrden: async () => { llamadas.buscarOrden++; return opciones.ordenEnWoo ?? null },
    crearOrden: async () => {
      llamadas.crearOrden++
      if (opciones.retardoMs) await esperar(opciones.retardoMs) // fuerza el solape de la carrera
      if (opciones.crearFalla?.()) throw new Error('woo_caido')
      return { id: ++siguienteOrden, ajustesRegistrados: opciones.ajustesRegistrados ?? [], ajustesPendientes: opciones.ajustesPendientes ?? [] }
    },
    marcarAjuste: async (orderId, motivos) => { llamadas.marcarAjuste.push({ orderId, motivos }) },
    enviarCorreos: async (c) => { llamadas.correos.push(c.tipo); return { sent: true } },
  }
  return { deps, llamadas }
}

await limpiar()
silenciar()
try {
  // ───────── 1. CARRERA: dos notificaciones a la vez → una sola orden ─────────
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ retardoMs: 700 })
    const [a, b] = await Promise.all([procesarPagoMp(id, deps), procesarPagoMp(id, deps)])
    const estados = [a.status, b.status].sort().join(',')
    restaurar()
    check('1. carrera (2 en paralelo): crearOrden se llamó UNA vez', llamadas.crearOrden === 1, `llamadas=${llamadas.crearOrden}`)
    check('1. carrera: una responde 200 con la orden y la otra 409', estados === '200,409', estados)
    const f = await fila(id)
    check('1. carrera: una fila, creada, con su orden e intentos=1', f?.estado === 'creada' && Number(f.order_id) === 9001 && f.intentos === 1, JSON.stringify(f))
    check('1. carrera: un solo correo de confirmación', llamadas.correos.filter(c => c === 'confirmacion').length === 1, llamadas.correos.join(','))
    silenciar()
    // El reintento de MP tras el 409 encuentra la fila creada.
    const c = await procesarPagoMp(id, deps)
    restaurar()
    check('1. el reintento tras el 409 → 200 duplicate con la misma orden, sin crear ni reenviar correos', c.status === 200 && c.body.duplicate === true && c.body.orderId === 9001 && llamadas.crearOrden === 1 && llamadas.correos.length === 1, JSON.stringify(c.body))
    silenciar()
  }
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ retardoMs: 500 })
    const rs = await Promise.all(Array.from({ length: 6 }, () => procesarPagoMp(id, deps)))
    restaurar()
    const n200 = rs.filter(r => r.status === 200).length
    check('1b. carrera (6 en paralelo): una orden, un 200 y cinco 409', llamadas.crearOrden === 1 && n200 === 1 && rs.filter(r => r.status === 409).length === 5, `crear=${llamadas.crearOrden} 200=${n200}`)
    silenciar()
  }

  // ───────── 2. creada → duplicate ─────────
  {
    const id = nuevoId()
    await sql.query(`INSERT INTO pagos_mp (payment_id, estado, order_id) VALUES ($1, 'creada', 4321)`, [id])
    const { deps, llamadas } = dobles()
    const r = await procesarPagoMp(id, deps)
    restaurar()
    check('2. fila creada → 200 duplicate con su orden; ni busca ni crea ni envía correos', r.status === 200 && r.body.duplicate === true && r.body.orderId === 4321 && llamadas.buscarOrden === 0 && llamadas.crearOrden === 0 && llamadas.correos.length === 0, JSON.stringify(r.body))
    silenciar()
  }

  // ───────── 3. procesando reciente → 409 ─────────
  {
    const id = nuevoId()
    await sql.query(`INSERT INTO pagos_mp (payment_id) VALUES ($1)`, [id])
    const { deps, llamadas } = dobles()
    const r = await procesarPagoMp(id, deps)
    restaurar()
    const f = await fila(id)
    check('3. procesando reciente → 409, sin tocar Woo y sin cambiar la fila', r.status === 409 && llamadas.buscarOrden === 0 && llamadas.crearOrden === 0 && f.estado === 'procesando' && f.intentos === 1, `status=${r.status} ${JSON.stringify(f)}`)
    silenciar()
    await sql.query(`UPDATE pagos_mp SET updated_at = now() - make_interval(mins => $2) WHERE payment_id = $1`, [id, PAGO_PROCESANDO_VIEJO_MIN - 1])
    const r2 = await procesarPagoMp(id, deps)
    restaurar()
    check(`3. procesando de hace ${PAGO_PROCESANDO_VIEJO_MIN - 1} min (bajo el umbral) → sigue siendo 409`, r2.status === 409 && llamadas.crearOrden === 0, `status=${r2.status}`)
    silenciar()
  }

  // ───────── 4. fallida → se retoma ─────────
  {
    const id = nuevoId()
    await sql.query(`INSERT INTO pagos_mp (payment_id, estado) VALUES ($1, 'fallida')`, [id])
    const { deps, llamadas } = dobles()
    const r = await procesarPagoMp(id, deps)
    restaurar()
    const f = await fila(id)
    check('4. fallida → se retoma: crea la orden, fila creada, intentos=2', r.status === 200 && !r.body.duplicate && llamadas.crearOrden === 1 && f.estado === 'creada' && f.intentos === 2, `status=${r.status} ${JSON.stringify(f)}`)
    silenciar()
  }

  // ───────── 5. procesando vieja → se retoma ─────────
  {
    const id = nuevoId()
    await sql.query(`INSERT INTO pagos_mp (payment_id, updated_at) VALUES ($1, now() - make_interval(mins => $2))`, [id, PAGO_PROCESANDO_VIEJO_MIN + 1])
    const { deps, llamadas } = dobles({ retardoMs: 700 }) // el retardo fuerza el solape: sin él la 2.ª llega con la fila ya creada (200 duplicate)
    const [a, b] = await Promise.all([procesarPagoMp(id, deps), procesarPagoMp(id, deps)])
    restaurar()
    const f = await fila(id)
    check(`5. procesando de hace ${PAGO_PROCESANDO_VIEJO_MIN + 1} min → se retoma (y solo UNA de dos simultáneas la gana)`, llamadas.crearOrden === 1 && [a.status, b.status].sort().join(',') === '200,409' && f.estado === 'creada' && f.intentos === 2, `crear=${llamadas.crearOrden} ${a.status},${b.status} ${JSON.stringify(f)}`)
    check('5. el umbral es de 10 min (mayor que los 5 min máximos de la función en Vercel)', PAGO_PROCESANDO_VIEJO_MIN === 10)
    silenciar()
  }

  // ───────── 6. pago no aprobado → sin fila ─────────
  for (const status of ['pending', 'in_process', 'rejected']) {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ status })
    const r = await procesarPagoMp(id, deps)
    restaurar()
    check(`6. ${status} → 200, sin fila en pagos_mp y sin tocar Woo ni correos`, r.status === 200 && r.body.status === status && (await fila(id)) === null && llamadas.buscarOrden === 0 && llamadas.crearOrden === 0 && llamadas.correos.length === 0, JSON.stringify(r.body))
    silenciar()
  }

  // ───────── 7. sin base de datos → 503 ─────────
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles()
    delete process.env.POSTGRES_URL
    const r = await procesarPagoMp(id, deps)
    process.env.POSTGRES_URL = url
    restaurar()
    check('7. sin BD → 503, sin tocar Woo; avisa a ventas del pago sin orden', r.status === 503 && llamadas.buscarOrden === 0 && llamadas.crearOrden === 0 && llamadas.correos.join(',') === 'fallo', `status=${r.status} correos=${llamadas.correos.join(',')}`)
    check('7. sin BD → no quedó fila', (await fila(id)) === null)
    silenciar()
  }

  // ───────── 8. crearOrden lanza → fallida + 503, y el reintento la recupera ─────────
  {
    const id = nuevoId()
    let caido = true
    const { deps, llamadas } = dobles({ crearFalla: () => caido })
    const r = await procesarPagoMp(id, deps)
    restaurar()
    const f = await fila(id)
    check('8. crearOrden lanza → 503, fila fallida y alerta de fallo (sin confirmación al cliente)', r.status === 503 && f.estado === 'fallida' && f.order_id === null && llamadas.correos.join(',') === 'fallo', `status=${r.status} ${JSON.stringify(f)} correos=${llamadas.correos.join(',')}`)
    silenciar()
    caido = false
    const r2 = await procesarPagoMp(id, deps)
    restaurar()
    const f2 = await fila(id)
    check('8. reintento de MP con Woo recuperado → crea la orden, fila creada, intentos=2', r2.status === 200 && f2.estado === 'creada' && f2.intentos === 2 && llamadas.correos.join(',') === 'fallo,confirmacion', `${JSON.stringify(f2)} correos=${llamadas.correos.join(',')}`)
    silenciar()
  }

  // ───────── extras ─────────
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ ordenEnWoo: { id: 770 } })
    const r = await procesarPagoMp(id, deps)
    restaurar()
    const f = await fila(id)
    check('9. segunda barrera: la orden ya existe en Woo → duplicate, fila creada con esa orden, no se crea otra ni se envían correos', r.status === 200 && r.body.duplicate === true && r.body.orderId === 770 && llamadas.crearOrden === 0 && llamadas.correos.length === 0 && f.estado === 'creada' && Number(f.order_id) === 770, JSON.stringify(f))
    silenciar()
  }
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ ajustesRegistrados: ['montos: no cuadran'], ajustesPendientes: ['001006004-P talla 12: se envió variation_id 5 y Woo guardó 0'] })
    const r = await procesarPagoMp(id, deps)
    restaurar()
    check('10. línea resuelta que volvió con variation_id 0 → marca la orden con TODOS los motivos y avisa a ventas; la orden sigue en 200', r.status === 200 && llamadas.marcarAjuste.length === 1 && llamadas.marcarAjuste[0].motivos.length === 2 && llamadas.correos.join(',') === 'ajuste_manual,confirmacion', `correos=${llamadas.correos.join(',')}`)
    silenciar()
  }
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ ajustesRegistrados: ['001-X: producto no encontrado'] })
    await procesarPagoMp(id, deps)
    restaurar()
    check('10b. ajuste ya escrito al crear la orden → avisa a ventas sin reescribir la orden', llamadas.marcarAjuste.length === 0 && llamadas.correos.join(',') === 'ajuste_manual,confirmacion', llamadas.correos.join(','))
    silenciar()
  }
  {
    const id = nuevoId()
    const { deps, llamadas } = dobles({ mpCaido: true })
    const r = await procesarPagoMp(id, deps)
    restaurar()
    check('11. MP no responde → 500 (MP reintenta), sin fila y sin tocar Woo', r.status === 500 && (await fila(id)) === null && llamadas.crearOrden === 0, `status=${r.status}`)
  }
}
finally {
  restaurar()
  await limpiar()
}

check('12. ningún log del proceso lleva el correo del pagador', !capturado.some(l => l.includes(CORREO_FALSO)), `${capturado.length} líneas revisadas`)
check('12. los logs identifican el pago por su paymentId', capturado.some(l => l.includes(PREFIJO)))

// ───────── forma de la línea que se envía a Woo (sin red: $fetch falso) ─────────
{
  let enviado = null
  globalThis.wooWriteConfigured = () => true
  globalThis.wooWriteCredentials = () => ({ baseUrl: 'https://woo.falso.test', key: 'ck_x', secret: 'cs_x', origen: 'write' })
  globalThis.resolverProductoTalla = async (sku, talla) => sku === '001006004-P'
    ? { ok: true, sku: `${sku}-T${talla}`, product_id: 500, variation_id: talla === '12' ? 512 : 514 }
    : { ok: false, sku, motivo: 'producto no encontrado' }
  // Woo "pierde" la variación 514 para probar la verificación posterior.
  globalThis.$fetch = async (_url, opts) => {
    enviado = opts.body
    return { id: 9100, status: 'processing', total: '0', line_items: opts.body.line_items.map(l => ({ variation_id: l.variation_id === 514 ? 0 : (l.variation_id ?? 0) })) }
  }
  const { createWooOrder } = await jiti.import('../server/utils/wooOrders.ts')
  silenciar()
  const orden = await createWooOrder({
    paymentId: 'test-forma', amount: 300000,
    items: [
      { sku: '001006004-P', title: 'Lady Bug (Talla 12)', quantity: 1, unitPrice: 100000, talla: '12' },
      { sku: '001006004-P', title: 'Lady Bug (Talla 14)', quantity: 1, unitPrice: 100000, talla: '14' },
      { sku: '999', title: 'Desconocido (Talla 4)', quantity: 1, unitPrice: 100000, talla: '4' },
    ],
  })
  restaurar()
  const [l12, l14, lx] = enviado.line_items
  check('13. línea resuelta: SOLO variation_id (sin sku ni product_id); el SKU va en meta_data', l12.variation_id === 512 && !('sku' in l12) && !('product_id' in l12) && l12.meta_data?.[0]?.key === 'sku' && l12.meta_data[0].value === '001006004-P', JSON.stringify(l12))
  check('13. línea sin resolver: va con sku y sin variation_id, y la orden queda marcada', lx.sku === '999' && !('variation_id' in lx) && orden.lineasSinEnlazar.length === 1 && enviado.meta_data.some(m => m.key === '_kustom_ajuste_manual'), JSON.stringify(lx))
  check('13. verificación posterior: la línea enviada con 514 y guardada con 0 se reporta; la que volvió bien, no', orden.lineasVariacionPerdida.length === 1 && orden.lineasVariacionPerdida[0].talla === '14' && l14.variation_id === 514, JSON.stringify(orden.lineasVariacionPerdida.map(l => l.motivo)))
  check('13. nombre, cantidad y totales de la línea no cambian', l12.name === 'Lady Bug (Talla 12)' && l12.quantity === 1 && l12.total === '100000' && l12.subtotal === '100000')
}

// ───────── comprobaciones estáticas del cableado ─────────
const hook = leer('server/api/webhooks/mercadopago.post.ts')
const checkout = leer('server/api/checkout/mercadopago.post.ts')
check('14. el webhook delega en procesarPagoMp y solo crea la orden desde sus dependencias', /await procesarPagoMp\(dataId, deps\)/.test(hook) && (hook.match(/createWooOrder\(/g) || []).length === 1 && (hook.match(/findWooOrderByPaymentId\(/g) || []).length === 1)
check('14. el webhook conserva la firma x-signature de MP y el precio anclado', /isValidSignature\(/.test(hook) && /statusCode: 401/.test(hook) && /leerAnclaje\(/.test(hook) && /verificarMontos\(/.test(hook))
check('14. sin "modo simulación" en producción: el webhook no mira el marcador de pruebas ni campos de simulación', !/simulacion|isTestDatabase|kustom_bd_pruebas/i.test(hook + leer('server/utils/procesarPagoMp.ts') + leer('server/utils/pagosMp.ts')))
check('14. la tabla pagos_mp está en la migración', /CREATE TABLE IF NOT EXISTS pagos_mp/.test(leer('server/utils/db.ts')))
check('15. notification_url usa el dominio canónico (siteBase), no el host de la petición', /notification_url: `\$\{siteBase\}\/api\/webhooks\/mercadopago`/.test(checkout) && !/notification_url: `\$\{origin\}/.test(checkout))

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exitCode = fails ? 1 : 0
