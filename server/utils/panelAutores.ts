/**
 * QUIÉN ESTÁ USANDO EL PANEL (NUXT_PANEL_AUTORES).
 *
 * Una sola contraseña para todo el equipo, así que el historial no podía decir
 * quién cambió qué: `inventory_changes.autor` llevaba null en todas las filas.
 * Esto lo arregla con lo mínimo: una lista fija de nombres, el panel pide elegir
 * uno al entrar y lo estampa en cada escritura.
 *
 * ⚠️ Es una ETIQUETA, no una identidad. Cualquiera con la contraseña puede elegir
 * cualquier nombre. Sirve para "¿quién bajó este precio?" entre gente que
 * colabora; NO sirve como prueba ni como control de acceso.
 */
export function panelAutores(): string[] {
  return String(useRuntimeConfig().panelAutores || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Normaliza el nombre que manda el panel. Devuelve undefined si no es uno de la
 * lista, para que un valor inventado quede en null en vez de ensuciar el
 * historial: más vale sin firmar que firmado de cualquier manera.
 */
export function autorValido(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined
  const v = valor.trim()
  if (!v) return undefined
  return panelAutores().find(a => a.toLowerCase() === v.toLowerCase())
}
