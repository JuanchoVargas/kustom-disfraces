// Lectura de WooCommerce con la llave de SOLO LECTURA de .env (WOO_API_URL,
// WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET). La comparten respaldo-woo y restaurar-woo.
// Nunca imprime las llaves: los errores pasan por `limpio()`.
import { readFileSync } from 'node:fs'

export function cargarEnvLocal() {
  const env = {}
  for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim()
  }
  return env
}

export const limpio = err => String(err?.message ?? err).replace(/consumer_(key|secret)=[^&\s"']+/g, 'consumer_$1=***')

export function clienteWooLectura(env = cargarEnvLocal()) {
  const base = String(env.WOO_API_URL || env.NUXT_WOO_BASE_URL || '').replace(/\/$/, '')
  const key = env.WOO_CONSUMER_KEY || env.NUXT_WOO_CONSUMER_KEY
  const secret = env.WOO_CONSUMER_SECRET || env.NUXT_WOO_CONSUMER_SECRET
  if (!base || !key || !secret) throw new Error('Falta la llave de SOLO LECTURA de Woo en .env (WOO_API_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET)')
  const get = async (path) => {
    const url = `${base}/wp-json/wc/v3${path}${path.includes('?') ? '&' : '?'}consumer_key=${key}&consumer_secret=${secret}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Woo ${path.split('?')[0]} → ${r.status}`)
    return r.json()
  }
  const todas = async (path) => {
    const out = []
    for (let page = 1; ; page++) {
      const lote = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      out.push(...lote)
      if (lote.length < 100) return out
    }
  }
  return { origen: base, get, todas }
}

/** Los campos de una variación que guarda el respaldo (lo demás no hace falta para restaurar). */
export const camposVariacion = v => ({
  id: v.id, sku: v.sku, status: v.status,
  regular_price: v.regular_price, sale_price: v.sale_price, price: v.price,
  manage_stock: v.manage_stock === true, stock_quantity: v.stock_quantity ?? null, stock_status: v.stock_status, backorders: v.backorders,
  attributes: (v.attributes || []).map(a => ({ name: a.name, option: a.option })),
  // Imagen propia de la variación (id de la biblioteca de medios). Ninguna escritura de
  // stock o precio la toca; se guarda para poder DEMOSTRARLO comparando contra el respaldo.
  image: v.image?.id ? { id: v.image.id, src: v.image.src } : null,
  date_modified_gmt: v.date_modified_gmt,
})

/** Lee las variaciones de varios productos con concurrencia acotada. Devuelve Map(idProducto → variaciones). */
export async function variacionesDe(woo, productos, { concurrencia = 6, progreso } = {}) {
  const out = new Map()
  const cola = [...productos]
  let hechos = 0
  await Promise.all(Array.from({ length: concurrencia }, async () => {
    for (let p; (p = cola.shift());) {
      out.set(p.id, p.type === 'variable' ? (await woo.todas(`/products/${p.id}/variations`)).map(camposVariacion) : [])
      if (progreso && ++hechos % 25 === 0) progreso(hechos, productos.length)
    }
  }))
  return out
}
