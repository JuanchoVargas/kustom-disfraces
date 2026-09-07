export interface StockAgotado {
  enabled: boolean
  agotados: string[]
  tallas: Record<string, string[]>
}

/**
 * LÓGICA DE AGOTADO (módulo de inventario). Durante el SSR trae de /api/stock
 * qué productos y tallas están agotados y lo hidrata en useState('stock-agotado');
 * useProducts lo aplica: producto agotado → fuera del catálogo; talla agotada →
 * soldOutSizes (no seleccionable en la PDP). Si el endpoint falla o el stock no
 * aplica (enabled:false), el sitio vende como siempre.
 */
export default defineNuxtPlugin(async () => {
  const stock = useState<StockAgotado | null>('stock-agotado', () => null)
  if (import.meta.server && !stock.value) {
    try {
      const r = await $fetch<StockAgotado>('/api/stock')
      stock.value = r?.enabled ? { enabled: true, agotados: r.agotados ?? [], tallas: r.tallas ?? {} } : { enabled: false, agotados: [], tallas: {} }
    }
    catch (err) {
      console.error('[stock] /api/stock falló; se asume todo disponible.', err)
      stock.value = { enabled: false, agotados: [], tallas: {} }
    }
  }
})
