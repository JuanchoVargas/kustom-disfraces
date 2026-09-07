// Mide el panel de inventario en una ventana REAL (Edge, con frames de verdad):
//   - tiempo hasta interactivo (domInteractive) y hasta las primeras filas
//   - con 100 productos por página y TODOS expandidos: nodos del DOM, altura y
//     fluidez de scroll (fps, p95 de frame, frames > 50 ms) durante 3 s
//   node medir.mjs <cookie kinbox> <etiqueta> [version=nueva|vieja]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const [cookie, label, version = 'nueva'] = process.argv.slice(2)
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await puppeteer.launch({ executablePath: EDGE, headless: false, args: ['--window-size=1400,1000', '--no-first-run', '--disable-features=CalculateNativeWinOcclusion'] })
const page = await browser.newPage()
await page.setViewport({ width: 1380, height: 900 })
await page.setCookie({ name: 'kinbox', value: cookie, domain: 'localhost', path: '/' })
await page.goto('http://localhost:3000/admin/inventario', { waitUntil: 'networkidle0', timeout: 60_000 })

const runs = []
for (let r = 0; r < 3; r++) {
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelectorAll('.row:not(.row--sk), tr.row').length > 0, { timeout: 30_000 })
  const load = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const mark = performance.getEntriesByName('inventario:filas')[0]
    const fetches = performance.getEntriesByType('resource').filter(x => x.name.includes('/api/inventario/productos'))
    return { domInteractive_ms: Math.round(nav.domInteractive), datos_ms: fetches[0] ? Math.round(fetches[0].responseEnd) : null, primeras_filas_ms: mark ? Math.round(mark.startTime) : null }
  })
  runs.push(load)
}
const med = k => { const v = runs.map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
const carga = { domInteractive_ms: med('domInteractive_ms'), datos_ms: med('datos_ms'), primeras_filas_ms: med('primeras_filas_ms') }

// 100 por página
await page.select('.pager select', '100')
await page.waitForFunction(() => (document.querySelector('.vlist__inner')?.style.height === '6400px') || document.querySelectorAll('tr.row').length >= 100, { timeout: 30_000 })
await new Promise(r => setTimeout(r, 800))

// expandir todo
const expand = await page.evaluate(async (version) => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const t0 = performance.now()
  if (version === 'nueva') { window.__inv.openAll() }
  else { for (const r of document.querySelectorAll('tr.row')) r.click() }
  await wait(0)
  const ms = performance.now() - t0
  await wait(800)
  return { expandir_100_ms: Math.round(ms), nodos_dom: document.querySelectorAll('*').length, detalles_en_dom: document.querySelectorAll('.detail, tr.detail').length }
}, version)

// scroll real durante 3 s (rAF) — contenedor propio en la nueva, window en la vieja
const scroll = await page.evaluate(async (version) => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const el = version === 'nueva' ? document.querySelector('.vlist') : null
  const setY = y => { if (el) el.scrollTop = y; else window.scrollTo(0, y) }
  const maxY = el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - innerHeight
  setY(0); await wait(300)
  const deltas = []
  let y = 0, last = performance.now(), frames = 0
  const t0 = performance.now()
  await new Promise((res) => {
    const step = (now) => {
      deltas.push(now - last); last = now; frames++
      y = Math.min(y + 45, maxY); setY(y)
      if (now - t0 < 3000 && y < maxY) requestAnimationFrame(step); else res()
    }
    requestAnimationFrame(step)
  })
  const dur = performance.now() - t0
  const s = [...deltas].sort((a, b) => a - b)
  const p = q => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] * 10) / 10
  return { fps: Math.round(frames / (dur / 1000)), frame_p50_ms: p(0.5), frame_p95_ms: p(0.95), frame_max_ms: Math.round(s.at(-1)), frames_largos_50ms: deltas.filter(d => d > 50).length, px: Math.round(y), altura_total_px: el ? el.scrollHeight : document.documentElement.scrollHeight, frames, dur_ms: Math.round(dur) }
}, version)

// coste de un tecleo en el buscador (input → nueva lista pintada)
const filtro = await page.evaluate(async () => {
  const inp = document.querySelector('.input--search')
  const t0 = performance.now()
  inp.value = 'spider'; inp.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((res) => { const t = setInterval(() => { if (document.querySelectorAll('.row:not(.row--sk), tr.row').length <= 8) { clearInterval(t); res() } }, 10); setTimeout(() => { clearInterval(t); res() }, 5000) })
  return { filtro_spider_ms: Math.round(performance.now() - t0), filas: document.querySelectorAll('.row:not(.row--sk), tr.row').length }
})

const out = { version: label, carga, expand, scroll, filtro }
console.log(JSON.stringify(out, null, 1))
fs.writeFileSync(`resultado-${label}.json`, JSON.stringify(out, null, 2))
await browser.close()
