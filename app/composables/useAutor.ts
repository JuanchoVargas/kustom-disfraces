/**
 * QUIÉN ESTÁ USANDO EL PANEL. Compartido por /admin, /admin/inventario y
 * /admin/chats (misma contraseña, misma cookie, mismo nombre elegido).
 *
 * El nombre se guarda en ESTE navegador y viaja en cada escritura: a
 * `inventory_changes.autor` en el inventario y a `meta.por` en los mensajes
 * salientes de la bandeja.
 *
 * ⚠️ Es una ETIQUETA, no una identidad: hay una sola contraseña y cualquiera
 * puede elegir cualquier nombre. Por eso el nombre va SIEMPRE visible en la
 * cabecera con un "no soy yo" al lado: el único modo de que esto empeore las
 * cosas es que alguien firme sin darse cuenta con el nombre de otro.
 *
 * Nunca bloquea: si no hay nombre, la escritura sigue saliendo y queda en null,
 * igual que antes de existir esto.
 */
const CLAVE = 'kustom_panel_autor'

export const useAutor = () => {
  const autor = useState<string>('panel-autor', () => '')
  const autores = useState<string[]>('panel-autores', () => [])
  // El selector se abre solo cuando hay sesión y todavía no se eligió nombre.
  const pidiendo = useState<boolean>('panel-autor-pidiendo', () => false)

  /** Lee el nombre guardado en este navegador. localStorage puede fallar (modo privado). */
  function cargar() {
    if (import.meta.server) return
    try { autor.value = localStorage.getItem(CLAVE) || '' }
    catch { autor.value = '' }
  }

  function elegir(nombre: string) {
    autor.value = nombre
    pidiendo.value = false
    try { localStorage.setItem(CLAVE, nombre) }
    catch { /* sin localStorage el nombre dura lo que la pestaña */ }
  }

  function olvidar() {
    autor.value = ''
    pidiendo.value = true
    try { localStorage.removeItem(CLAVE) }
    catch { /* nada que limpiar */ }
  }

  /**
   * Arranque tras confirmar la sesión: guarda la lista de nombres y, si el
   * guardado ya no está en ella (alguien salió del equipo), lo descarta y vuelve
   * a preguntar en vez de seguir firmando con un nombre que ya no existe.
   */
  function iniciar(lista: string[]) {
    autores.value = lista
    cargar()
    if (autor.value && lista.length && !lista.includes(autor.value)) autor.value = ''
    pidiendo.value = !autor.value && lista.length > 0
  }

  /** Cuerpo de una escritura del inventario, con la firma si la hay. */
  const conAutor = <T extends Record<string, unknown>>(body: T) => (autor.value ? { ...body, autor: autor.value } : body)

  return { autor, autores, pidiendo, iniciar, elegir, olvidar, conAutor }
}
