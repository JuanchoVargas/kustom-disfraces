import { esRutaAdmin } from '~/composables/useMetaPixel'

/**
 * META PIXEL — carga e inicio (solo navegador, sin dependencias).
 *
 * - Sin NUXT_PUBLIC_META_PIXEL_ID no hace NADA: ni script, ni window.fbq, ni una
 *   sola petición a Meta. La variable se configura solo en Production.
 * - En /admin/* no se carga ni se registra ninguna vista. Si alguien llega al sitio
 *   público desde /admin en la misma sesión, el pixel se carga en ese momento.
 * - PageView al cargar y en cada cambio de RUTA (no de query: los filtros de la PLP
 *   no son páginas). El primero no se duplica: se recuerda la última ruta vista y
 *   se desactiva el PageView automático de Meta por history.pushState.
 * - init SIN advanced matching (sin segundo argumento con datos del usuario) y con
 *   autoConfig apagado: Meta no recoge por su cuenta clics de botones ni metadatos
 *   de la página. Solo salen los eventos que dispara useMetaPixel().
 */
export default defineNuxtPlugin((nuxtApp) => {
  const id = String(useRuntimeConfig().public.metaPixelId || '').trim()
  if (!id) return

  let ultimaRuta: string | null = null

  function cargar() {
    if (typeof window.fbq === 'function') return
    // Cola estándar de fbq: acumula las llamadas hasta que fbevents.js esté listo.
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args)
      else fbq.queue.push(args)
    } as NonNullable<Window['fbq']> & { queue: unknown[] }
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    fbq.queue = []
    fbq.disablePushState = true // los PageView de ruta los dispara este plugin, no Meta
    window.fbq = fbq
    if (!window._fbq) window._fbq = fbq

    const s = document.createElement('script')
    s.async = true
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(s)

    // ORDEN OBLIGATORIO: autoConfig se apaga ANTES de init. Si fuera al revés, init
    // ya habría activado la recolección automática (clics, metadatos) para este ID.
    fbq('set', 'autoConfig', false, id)
    fbq('init', id)
  }

  function vista(path: string) {
    // /admin/*: ni carga ni vista. Se olvida la última ruta para que volver al sitio
    // público (aunque sea a la misma página) cuente como una vista nueva.
    if (esRutaAdmin(path)) { ultimaRuta = null; return }
    if (path === ultimaRuta) return // mismo path (p. ej. solo cambió el query): no es otra página
    cargar()
    ultimaRuta = path
    window.fbq!('track', 'PageView')
  }

  // La navegación inicial puede disparar afterEach antes o después de app:mounted:
  // ambos llaman a vista() y el segundo se descarta por ser la misma ruta.
  const router = useRouter()
  nuxtApp.hook('app:mounted', () => vista(router.currentRoute.value.path))
  router.afterEach(to => vista(to.path))
})
