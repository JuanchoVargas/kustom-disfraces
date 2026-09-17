// Comparación PURA entre un respaldo de Woo y lo que Woo tiene hoy. Sin red ni disco:
// la usan scripts/restaurar-woo.mjs y scripts/test-restaurar-woo.mjs.

/** Las tres cosas que se restauran, normalizadas para poder compararlas. */
export const estadoStock = v => ({
  manage_stock: v.manage_stock === true,
  stock_quantity: v.manage_stock === true ? (v.stock_quantity ?? 0) : null, // sin gestión Woo no guarda cantidad
  stock_status: v.stock_status,
})
export const igual = (a, b) => a.manage_stock === b.manage_stock && a.stock_quantity === b.stock_quantity && a.stock_status === b.stock_status
export const txt = s => `${s.manage_stock ? `gestiona · ${s.stock_quantity}` : 'sin gestionar'} · ${s.stock_status}`

/** Compara respaldo vs Woo de hoy (Map idProducto → variaciones). `solo` filtra por código de producto o SKU de talla. */
export function calcularRestauracion(respaldo, actuales, solo = []) {
  const cambios = [], avisos = []
  let iguales = 0
  for (const p of respaldo) {
    const hoy = actuales.get(p.id)
    for (const v of p.variaciones) {
      if (solo.length && !solo.includes(p.sku) && !solo.includes(v.sku)) continue
      const a = hoy?.find(x => x.id === v.id)
      if (!a) { avisos.push(`${v.sku || `variación ${v.id}`} (${p.name}): ya no existe en Woo — no se puede restaurar`); continue }
      if (a.sku !== v.sku) { avisos.push(`variación ${v.id} (${p.name}): en el respaldo era ${v.sku} y hoy es ${a.sku} — no se toca`); continue }
      const antes = estadoStock(a), despues = estadoStock(v)
      if (igual(antes, despues)) { iguales++; continue }
      cambios.push({ sku: v.sku, producto: p.name, estado: p.status, antes, despues })
    }
  }
  return { cambios, avisos, iguales }
}
