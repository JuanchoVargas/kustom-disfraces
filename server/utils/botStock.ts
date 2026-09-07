import { getStockState } from './stockState'

/**
 * Stock para el BOT (búsqueda y menús son SÍNCRONOS): los webhooks llaman
 * `await refreshBotStock()` antes de construir la respuesta y aquí quedan, en
 * módulo, el conjunto de productos agotados y las tallas agotadas por código.
 * productSearch.ts y catalogNav.ts los consultan de forma síncrona.
 * Si el stock no aplica (ver stockState.ts) los conjuntos quedan vacíos.
 */
let agotados = new Set<string>()
let tallasAgotadas = new Map<string, string[]>()

export async function refreshBotStock(): Promise<void> {
  try {
    const st = await getStockState()
    agotados = st.enabled ? st.agotados : new Set()
    tallasAgotadas = st.enabled ? st.tallasAgotadas : new Map()
  }
  catch {
    agotados = new Set()
    tallasAgotadas = new Map()
  }
}

/** ¿El producto (código) está totalmente agotado? → fuera de búsquedas y conteos. */
export function productoAgotado(codigo: string): boolean {
  return agotados.has(codigo)
}

export function tallaAgotada(codigo: string, talla: string | number): boolean {
  const t = String(talla).toLowerCase()
  return (tallasAgotadas.get(codigo) ?? []).some(x => x.toLowerCase() === t)
}

/** Tallas disponibles de un producto (las del catálogo menos las agotadas). */
export function tallasDisponibles(codigo: string, tallas: (string | number)[]): (string | number)[] {
  return tallas.filter(t => !tallaAgotada(codigo, t))
}
