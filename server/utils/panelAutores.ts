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

/**
 * ¿Está bien puesta la lista? Sin esto, una variable vacía o mal escrita deja a
 * todo el mundo sin firmar EN SILENCIO — que es exactamente el agujero que la
 * atribución venía a tapar. El panel enseña estos avisos en la cabecera.
 *
 * No valida nombres (cualquiera es válido), solo las formas de escribirla mal
 * que dejan la firma rota sin que se note.
 */
export function panelAutoresDiagnostico(): { autores: string[], problemas: string[] } {
  const crudo = String(useRuntimeConfig().panelAutores || '')
  const autores = panelAutores()
  const problemas: string[] = []

  if (!crudo.trim()) {
    problemas.push('NUXT_PANEL_AUTORES está vacía: nadie firma sus cambios y el historial queda sin autor.')
  }
  else if (!autores.length) {
    problemas.push(`NUXT_PANEL_AUTORES no tiene ningún nombre utilizable (valor: "${crudo.slice(0, 60)}"): nadie firma sus cambios.`)
  }
  else {
    // Separador equivocado: "Lesly;Jaime" parsea como UN nombre con punto y coma
    // dentro, así que la lista "funciona" y sin embargo nadie puede elegirse.
    const raros = autores.filter(a => /[;|\t/]/.test(a))
    if (raros.length) {
      problemas.push(`NUXT_PANEL_AUTORES parece usar otro separador: ${raros.map(a => `"${a}"`).join(', ')}. Los nombres van separados por COMA.`)
    }
    const vistos = new Map<string, string>()
    for (const a of autores) {
      const k = a.toLowerCase()
      if (vistos.has(k) && vistos.get(k) !== a) problemas.push(`NUXT_PANEL_AUTORES repite un nombre con distinta forma ("${vistos.get(k)}" y "${a}"): deja solo uno.`)
      else if (vistos.has(k)) problemas.push(`NUXT_PANEL_AUTORES repite "${a}".`)
      vistos.set(k, a)
    }
    const largos = autores.filter(a => a.length > 40)
    if (largos.length) problemas.push(`NUXT_PANEL_AUTORES tiene un valor demasiado largo para ser un nombre: "${largos[0]!.slice(0, 45)}…".`)
  }
  return { autores, problemas }
}
