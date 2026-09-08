#!/usr/bin/env node
// Guía visual del panel de inventario: captura la secuencia completa del panel
// en dos viewports (escritorio 1440×900 y celular 390×844) con Playwright, y
// resalta el elemento clave de cada paso con un recuadro rojo dibujado por el
// script. Repetible: si cambia la interfaz se vuelve a correr y se regeneran todas.
//
//   node scripts/capturas-guia.mjs                 # PRODUCCIÓN (www.disfraceskustom.com)
//   node scripts/capturas-guia.mjs --local          # contra npm run dev (localhost:3000)
//   opciones: --solo escritorio|movil · --ver (ventana visible) · --copiar <carpeta>
//             BASE_URL=https://… para otro origen (p. ej. un preview)
//
// Requiere en .env (la contraseña NUNCA va en el código):
//   NUXT_INBOX_PASSWORD_PROD  contraseña del panel en producción (o NUXT_INBOX_PASSWORD
//                             si es la misma); con --local usa NUXT_INBOX_PASSWORD
//   POSTGRES_URL              la base del entorno capturado, para revertir al final
// Usa el Edge instalado (playwright-core, canal msedge): no descarga navegadores.
//
// Datos: reales (snapshot local de Woo, adaptador mock). Los pasos que editan
// (06-07 precio, 09-10 masiva, 14 stock) se hacen SOLO sobre BORRADORES y al
// final se revierten borrando sus sobreescrituras y su historial (autor
// "guia-capturas"). La captura 13 (imágenes) intercepta la respuesta del
// endpoint de imágenes para mostrar principal + galería con las fotos REALES del
// producto: en local no hay credenciales de WordPress y la migración de fotos
// aún no corrió, así que el panel aquí solo mostraría el candado. Lo que se ve
// es lo que el panel muestra en producción cuando la edición está abierta.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { neon } from '@neondatabase/serverless'

// ---------- configuración ----------
const args = process.argv.slice(2)
const SOLO = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null
const VER = args.includes('--ver')
const LOCAL = args.includes('--local')
const COPIAR = args.includes('--copiar') ? args[args.indexOf('--copiar') + 1] : null
const BASE = (process.env.BASE_URL || (LOCAL ? 'http://localhost:3000' : 'https://www.disfraceskustom.com')).replace(/\/$/, '')
const OUT = path.resolve('docs/guia/capturas')
const AUTOR = 'guia-capturas'

const env = Object.fromEntries(
  fs.existsSync('.env')
    ? fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
    : [],
)
const PASSWORD = LOCAL
  ? (process.env.NUXT_INBOX_PASSWORD || env.NUXT_INBOX_PASSWORD)
  : (process.env.NUXT_INBOX_PASSWORD_PROD || env.NUXT_INBOX_PASSWORD_PROD || process.env.NUXT_INBOX_PASSWORD || env.NUXT_INBOX_PASSWORD)
if (!PASSWORD) { console.error(`Falta ${LOCAL ? 'NUXT_INBOX_PASSWORD' : 'NUXT_INBOX_PASSWORD_PROD'} en .env`); process.exit(1) }
const DB_URL = process.env.POSTGRES_URL || env.POSTGRES_URL || env.DATABASE_URL
const sql = DB_URL ? neon(DB_URL) : null

// Productos usados (todos BORRADORES salvo el de imágenes)
const P = {
  editar: { sku: '001008004', nombre: 'MERLINA', tallaSku: '001008004-T4', precioNuevo: '125900' }, // 06-07
  masiva: 'VESTIDO DAMA', // 08-10: 001008005..008 (4 borradores)
  bajo: { sku: '001008005-TS', stock: 2 }, // 14 ámbar (umbral NUXT_INVENTORY_STOCK_BAJO, default 5)
  agotado: '001008006', // 14 rojo: todas las tallas en 0
  imagenes: { sku: '001001001', nombre: 'Spider-Man Clásico' }, // 13: 3 fotos reales
}
const SKUS_TOCADOS = ['001008004', '001008005', '001008006', '001008007', '001008008']

const EDGE_ARGS = ['--no-first-run', '--disable-features=CalculateNativeWinOcclusion']
const VIEWPORTS = {
  escritorio: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  movil: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

// ---------- utilidades ----------
const log = (...a) => console.log(...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Dibuja recuadros rojos (fijos, en coordenadas del viewport) alrededor de los elementos. */
async function marcar(page, locators) {
  const rects = []
  for (const loc of [].concat(locators)) {
    const n = await loc.count()
    for (let i = 0; i < n; i++) {
      const box = await loc.nth(i).boundingBox()
      if (box && box.width > 0 && box.height > 0) rects.push(box)
    }
  }
  await page.evaluate((rects) => {
    document.querySelectorAll('.__guia-mark').forEach(e => e.remove())
    for (const r of rects) {
      const d = document.createElement('div')
      d.className = '__guia-mark'
      Object.assign(d.style, {
        position: 'fixed', left: `${r.x - 5}px`, top: `${r.y - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px`,
        border: '3px solid #E0192B', borderRadius: '8px', boxShadow: '0 0 0 3px rgba(255,255,255,.85), 0 0 0 9999px rgba(15,15,30,.06)',
        pointerEvents: 'none', zIndex: 2147483647, boxSizing: 'border-box',
      })
      document.body.appendChild(d)
    }
  }, rects)
  return rects.length
}
async function desmarcar(page) {
  await page.evaluate(() => document.querySelectorAll('.__guia-mark').forEach(e => e.remove()))
}

/** Espera a que no queden esqueletos y a que las miniaturas visibles hayan cargado de verdad. */
async function esperarLista(page) {
  await page.waitForFunction(() => !document.querySelector('.row--sk') && !document.querySelector('.vlist.is-loading'), null, { timeout: 30_000 })
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('img.thumb, .imgs__grid img, .empty__ko')]
    const vh = window.innerHeight
    return imgs.filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < vh }).every(i => i.complete && i.naturalWidth > 0)
  }, null, { timeout: 30_000 }).catch(() => log('   (aviso: alguna miniatura no cargó a tiempo)'))
  await sleep(250) // fin de transiciones CSS
}

/** Escribe en el buscador y espera la respuesta de la API para ESE término (no un tiempo fijo). */
async function buscar(page, texto) {
  const input = page.locator('.search__input')
  if ((await input.inputValue()) === texto) return
  const respuesta = page.waitForResponse((r) => {
    if (!r.url().includes('/api/inventario/productos?')) return false
    const url = decodeURIComponent(r.url()).split('+').join(' ')
    return texto ? url.includes(`q=${texto}`) : !/[?&]q=[^&]/.test(url)
  }, { timeout: 20_000 }).catch(() => null)
  await input.fill(texto)
  await respuesta
  await sleep(150)
  await esperarLista(page)
}

async function limpiarFiltros(page) {
  const btn = page.getByRole('button', { name: 'Limpiar' })
  if (await btn.count()) await btn.click()
  await sleep(450)
  await esperarLista(page)
}

async function abrirProducto(page, textoBusqueda, sku) {
  await buscar(page, textoBusqueda)
  const row = page.locator('.row', { has: page.locator(`.mono:text-is("${sku}")`) }).first()
  await row.scrollIntoViewIfNeeded()
  // El bloque expandido de ESTE producto (contiene los SKU de sus tallas). El panel
  // recuerda lo expandido entre búsquedas: si ya está abierto no se vuelve a pulsar.
  const detalle = detalleDe(page, sku)
  for (let intento = 0; intento < 3; intento++) {
    if (await detalle.isVisible().catch(() => false)) break
    await row.click()
    await detalle.waitFor({ timeout: 4_000 }).catch(() => {})
  }
  await detalle.waitFor({ timeout: 10_000 })
  await sleep(350)
  return row
}

const detalleDe = (page, sku) => page.locator('.detail.is-open', { has: page.locator(`td:text-matches("^${sku}-T")`) }).first()

let contador = 0
async function captura(page, dir, nombre, locators, opts = {}) {
  contador++
  const n = nombre.slice(0, 2)
  const marcados = locators ? await marcar(page, locators) : 0
  await sleep(120)
  const file = path.join(dir, `${nombre}.png`)
  await page.screenshot({ path: file, fullPage: !!opts.fullPage })
  await desmarcar(page)
  log(`   ${n} ✓ ${path.basename(file)}${marcados ? '' : '  (sin elementos que resaltar)'}`)
}

// ---------- API del panel (misma sesión que el navegador) ----------
async function api(ctx, ruta, data) {
  const r = await ctx.request.post(`${BASE}/api/inventario${ruta}`, { data })
  if (!r.ok()) throw new Error(`${ruta} → HTTP ${r.status()}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

/** Prepara el semáforo de stock (14) sobre borradores: una talla baja y un producto agotado. */
async function prepararStock(ctx) {
  const ops = [{ op: 'stock', sku: P.bajo.sku, stock_quantity: P.bajo.stock, manage_stock: true }]
  const r = await ctx.request.get(`${BASE}/api/inventario/productos/${P.agotado}`)
  const prod = (await r.json()).product
  for (const v of prod.variations) ops.push({ op: 'stock', sku: v.sku, stock_quantity: 0, manage_stock: true })
  const res = await api(ctx, '/operaciones', { operaciones: ops, origen: 'panel', autor: AUTOR })
  log(`   stock de prueba: ${res.ok} ok / ${res.fallidas} fallidas`)
}

/** Estado previo de las sobreescrituras de los borradores usados, para dejarlas EXACTAMENTE igual. */
let previas = null
async function guardarEstadoPrevio() {
  if (!sql) { log('⚠ Sin POSTGRES_URL: no se podrá revertir automáticamente'); return }
  previas = await sql.query(`SELECT sku, regular_price, sale_price, manage_stock, stock_quantity, updated_at, updated_by FROM inventory_overrides WHERE split_part(sku, '-T', 1) = ANY($1::text[])`, [SKUS_TOCADOS])
  log(`   estado previo guardado: ${previas.length} sobreescrituras existentes en ${SKUS_TOCADOS.length} borradores`)
}

/** Revierte TODO lo que la guía tocó: repone las sobreescrituras previas y borra el historial con autor guia-capturas. */
async function revertir() {
  if (!sql) { log('⚠ Sin POSTGRES_URL: no se pudo revertir. Borra a mano las sobreescrituras de', SKUS_TOCADOS.join(', ')); return }
  const a = await sql.query(`DELETE FROM inventory_overrides WHERE split_part(sku, '-T', 1) = ANY($1::text[]) RETURNING sku`, [SKUS_TOCADOS])
  for (const p of previas ?? []) {
    await sql.query(`INSERT INTO inventory_overrides (sku, regular_price, sale_price, manage_stock, stock_quantity, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [p.sku, p.regular_price, p.sale_price, p.manage_stock, p.stock_quantity, p.updated_at, p.updated_by])
  }
  const b = await sql.query(`DELETE FROM inventory_changes WHERE autor = $1 RETURNING id`, [AUTOR])
  log(`🧹 revertido: ${a.length} sobreescrituras quitadas, ${(previas ?? []).length} previas repuestas, ${b.length} filas de historial borradas (solo borradores ${SKUS_TOCADOS.join(', ')})`)
}

function csvImportacion() {
  // Filas correctas (borradores) y filas con error, para la previsualización (12). No se aplica.
  const rows = [
    ['SKU', 'Producto', 'Talla', 'Precio normal', 'Precio rebajado', 'Stock'],
    ['001008008-TS', 'VESTIDO DAMA BATICHICA', 'S', '125900', '', '6'],
    ['001008008-TM', 'VESTIDO DAMA BATICHICA', 'M', '125900', '99900', ''],
    ['001008008-TL', 'VESTIDO DAMA BATICHICA', 'L', 'ciento veinte', '', ''],
    ['001008007-TS', 'VESTIDO DAMA MUJER ARAÑA', 'S', '119900', '', ''],
    ['999999999-TX', 'SKU QUE NO EXISTE', 'X', '100000', '', '1'],
  ]
  const file = path.join(OUT, '.import-guia.csv')
  fs.writeFileSync(file, rows.map(r => r.join(';')).join('\n'), 'utf8')
  return file
}

/** Respuesta simulada de imágenes (13): fotos reales del producto, edición abierta. */
function respuestaImagenes(sku, fotos) {
  return {
    sku, status: 'publish', bloqueo: null,
    images: fotos.map((src, i) => ({ id: 9000 + i, src: `${BASE}${src}`, name: `${sku}${i ? `-${i + 1}` : ''}.webp`, alt: P.imagenes.nombre })),
    variaciones: [],
  }
}

async function comprobarAcceso() {
  const r = await fetch(`${BASE}/api/inbox/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
  if (r.status === 401) throw new Error(`${BASE} rechazó la contraseña (401). En producción la contraseña del panel es la de Vercel: ponla en .env como NUXT_INBOX_PASSWORD_PROD.`)
  if (!r.ok) throw new Error(`${BASE}/api/inbox/login → HTTP ${r.status}`)
  const v = await fetch(`${BASE}/api/version`).then(x => x.json()).catch(() => null)
  log(`🔐 acceso OK a ${BASE}${v?.commit_corto ? ` · commit ${v.commit_corto} (${v.entorno})` : ''}`)
}

// ---------- secuencia ----------
async function secuencia(browser, modo) {
  const dir = path.join(OUT, modo)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const movil = modo === 'movil'
  log(`\n▶ ${modo} (${VIEWPORTS[modo].viewport.width}×${VIEWPORTS[modo].viewport.height})`)
  const ctx = await browser.newContext({ ...VIEWPORTS[modo], locale: 'es-CO', colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  // Artefactos SOLO del entorno local (--local) que no existen en producción: el
  // widget de Nuxt DevTools y el candado "faltan credenciales de WordPress".
  await ctx.addInitScript(() => {
    const css = '#nuxt-devtools-anchor, nuxt-devtools-frame, #nuxt-devtools-container, .nuxt-devtools-frame { display: none !important } .imgs__block { display: none !important }'
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s) }
    document.head ? add() : document.addEventListener('DOMContentLoaded', add)
  })

  // Fotos reales del producto de la captura 13 (catalogo.json)
  const catalogo = JSON.parse(fs.readFileSync('app/data/catalogo.json', 'utf8'))
  const prodImg = (catalogo.productos ?? catalogo).find(p => p.codigo === P.imagenes.sku)
  const fotos = prodImg?.imagenes?.length ? prodImg.imagenes : [prodImg?.imagen].filter(Boolean)
  await page.route(`**/api/inventario/productos/${P.imagenes.sku}/imagenes`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuestaImagenes(P.imagenes.sku, fotos)) }))

  try {
    // 01 login
    await page.goto(`${BASE}/admin/inventario`, { waitUntil: 'networkidle' })
    await page.locator('form.login').waitFor()
    await captura(page, dir, '01-login', page.locator('form.login'))

    // 02 inventario recién cargado
    await page.locator('#pw').fill(PASSWORD)
    await page.locator('form.login button[type=submit]').click()
    await page.locator('.top__totals').waitFor({ state: 'attached', timeout: 30_000 })
    await esperarLista(page)
    await prepararStock(ctx) // stock de prueba para la 14 (borradores)
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.top__totals').waitFor({ state: 'attached', timeout: 30_000 })
    await esperarLista(page)
    // En celular la cabecera de totales va oculta: se resalta la cabecera completa.
    await captura(page, dir, '02-inventario-cargado', movil ? page.locator('.top__row') : page.locator('.top__totals'))

    // 03 buscador
    await buscar(page, 'spider')
    await captura(page, dir, '03-buscador-spider', [page.locator('.search'), page.locator('.row').first()])

    // 04 filtros
    await buscar(page, '')
    await page.locator('select[aria-label="Público"]').selectOption('ninas')
    await page.locator('select[aria-label="Línea"]').selectOption('vestidos')
    await sleep(450)
    await esperarLista(page)
    await captura(page, dir, '04-filtros-publico-linea', [page.locator('select[aria-label="Línea"]'), page.locator('select[aria-label="Público"]')])
    await limpiarFiltros(page)

    // 05 producto expandido
    await abrirProducto(page, P.editar.nombre, P.editar.sku)
    const vars = detalleDe(page, P.editar.sku).locator('.vars')
    await vars.scrollIntoViewIfNeeded()
    await captura(page, dir, '05-producto-expandido-tallas', vars)

    // 06 precio en edición
    const fila = page.locator('.detail.is-open .vars tbody tr', { hasText: P.editar.tallaSku }).first()
    const inputPrecio = fila.locator('input').first()
    await inputPrecio.fill(P.editar.precioNuevo.slice(0, 4)) // valor a medio escribir
    await inputPrecio.focus()
    await captura(page, dir, '06-precio-en-edicion', [inputPrecio, fila.locator('.actions')])

    // 07 destello verde al guardar (animación desactivada para que quede fijo)
    await inputPrecio.fill(P.editar.precioNuevo)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await inputPrecio.press('Enter')
    const filaResultado = page.locator('.detail.is-open .vars tbody tr.is-flash, .detail.is-open .vars tbody tr.is-err').first()
    await filaResultado.waitFor({ timeout: 15_000 })
    if (/(^| )is-err( |$)/.test(await filaResultado.getAttribute('class') ?? '')) throw new Error('el guardado del precio falló: ' + await filaResultado.locator('.err').innerText().catch(() => '?'))
    await captura(page, dir, '07-guardado-destello-verde', page.locator('.detail.is-open .vars tbody tr.is-flash').first())
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await sleep(1300)

    // 08 selección múltiple
    await buscar(page, P.masiva)
    const checks = page.locator('.row .col-check input')
    const nSel = Math.min(3, await checks.count())
    for (let i = 0; i < nSel; i++) await checks.nth(i).check()
    await sleep(200)
    await captura(page, dir, '08-seleccion-multiple', [page.locator('.row.is-sel'), page.locator('.toolbar')])

    // 09 operación masiva: vista previa antes → después
    await page.getByRole('button', { name: /Operación masiva/ }).click()
    const modal = page.locator('.modal__box')
    await modal.waitFor()
    await modal.locator('select').first().selectOption('porcentaje')
    await modal.locator('input[inputmode=numeric]').first().fill('5')
    await modal.getByRole('button', { name: 'Previsualizar' }).click()
    await modal.locator('.preview__wrap').waitFor({ timeout: 30_000 })
    await sleep(300)
    await captura(page, dir, '09-masiva-antes-despues', [modal.locator('.preview__summary'), modal.locator('.preview__wrap'), modal.getByRole('button', { name: /Aplicar/ })])

    // 10 resultado aplicado
    await modal.getByRole('button', { name: /Aplicar/ }).click()
    await modal.locator('p.ok, p.err').first().waitFor({ timeout: 30_000 })
    await sleep(300)
    await captura(page, dir, '10-masiva-resultado', modal.locator('p.ok, p.err').first())
    await modal.getByRole('button', { name: 'Cerrar' }).click()
    await page.locator('.row.is-sel input').first().uncheck().catch(() => {})
    await page.locator('.toolbar .linkbtn', { hasText: 'quitar' }).click().catch(() => {})

    // 11 exportar
    await captura(page, dir, '11-exportar-excel-csv', [page.getByRole('link', { name: 'Exportar Excel' }), page.getByRole('link', { name: 'CSV' })])

    // 12 previsualización de importación (correctas + errores; no se aplica)
    await page.getByRole('button', { name: 'Importar' }).click()
    await modal.waitFor()
    await modal.locator('input[type=file]').setInputFiles(csvImportacion())
    await modal.getByRole('button', { name: 'Previsualizar' }).click()
    await modal.locator('.preview__wrap').waitFor({ timeout: 30_000 })
    await sleep(300)
    await captura(page, dir, '12-importacion-previsualizacion', [modal.locator('.preview__summary'), modal.locator('.preview__wrap')])
    await modal.getByRole('button', { name: 'Cerrar' }).click()

    // 13 imágenes: principal + galería
    await abrirProducto(page, P.imagenes.nombre, P.imagenes.sku)
    const imgs = page.locator('.detail.is-open .imgs').first()
    await imgs.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await page.locator('.detail.is-open .imgs__item').first().waitFor({ timeout: 15_000 })
    await esperarLista(page)
    await captura(page, dir, '13-imagenes-principal-galeria', [page.locator('.detail.is-open .imgs__item.is-main'), page.locator('.detail.is-open .imgs__add')])

    // 14 semáforo: stock bajo (ámbar) y agotado (rojo)
    await buscar(page, P.masiva)
    const filaBajo = page.locator('.row', { has: page.locator(`.mono:text-is("${P.bajo.sku.split('-T')[0]}")`) }).first()
    const filaAgotado = page.locator('.row', { has: page.locator(`.mono:text-is("${P.agotado}")`) }).first()
    await page.locator('.vlist').evaluate(el => { el.scrollTop = 0 }) // las dos filas arriba, completas
    await sleep(300)
    await captura(page, dir, '14-semaforo-stock-bajo-agotado', [filaBajo, filaAgotado, filaBajo.locator('.stock'), filaAgotado.locator('.stock')])

    // 15 estado vacío con KO
    await buscar(page, 'zzzz')
    await page.locator('.empty').waitFor()
    await esperarLista(page)
    await captura(page, dir, '15-estado-vacio', page.locator('.empty'))

    // 16 conmutador cómodo / compacto
    await buscar(page, '')
    await page.locator('.seg button', { hasText: 'Compacto' }).click()
    await sleep(400)
    await esperarLista(page)
    await captura(page, dir, '16-conmutador-compacto', page.locator('.seg'))
    await page.locator('.seg button', { hasText: 'Cómodo' }).click()

    if (movil) {
      // 17 lista en tarjetas
      await sleep(400)
      await esperarLista(page)
      await captura(page, dir, '17-movil-lista-tarjetas', page.locator('.row').first())
      // 18 producto expandido con tallas
      await abrirProducto(page, P.editar.nombre, P.editar.sku)
      const v2 = detalleDe(page, P.editar.sku).locator('.vars')
      await v2.scrollIntoViewIfNeeded()
      await captura(page, dir, '18-movil-producto-expandido', v2)
    }
  }
  finally {
    await ctx.close()
  }
}

// ---------- main ----------
fs.mkdirSync(OUT, { recursive: true })
let fallo = null
let browser = null
try {
  await comprobarAcceso()
  await guardarEstadoPrevio()
  browser = await chromium.launch({ channel: 'msedge', headless: !VER, args: EDGE_ARGS })
  for (const modo of ['escritorio', 'movil']) {
    if (SOLO && SOLO !== modo) continue
    await secuencia(browser, modo)
    await revertir() // cada viewport parte de los datos originales (si no, el precio ya estaría cambiado)
  }
}
catch (err) { fallo = err; console.error('❌', err?.message ?? err) }
finally {
  if (browser) await browser.close()
  if (fallo && previas) await revertir().catch(e => console.error('⚠ no se pudo revertir:', e.message))
  fs.rmSync(path.join(OUT, '.import-guia.csv'), { force: true })
}
if (!fallo && COPIAR) {
  // Copia de entrega: <carpeta>/{escritorio,movil}/NN-*.png
  for (const modo of ['escritorio', 'movil']) {
    const src = path.join(OUT, modo)
    if (!fs.existsSync(src)) continue
    const dst = path.join(COPIAR, modo)
    fs.mkdirSync(dst, { recursive: true })
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f))
  }
  log(`📁 copiadas a ${COPIAR}`)
}
log(`\n${fallo ? '❌ incompleto' : '✅ listo'}: ${contador} capturas en ${OUT}`)
process.exit(fallo ? 1 : 0)
