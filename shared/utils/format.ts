/**
 * Formato de moneda colombiana: 89900 -> "$89.900".
 * Auto-importado por Nuxt 4 (shared/utils).
 */
export function formatCOP(value: number): string {
  return '$' + new Intl.NumberFormat('es-CO').format(value)
}
