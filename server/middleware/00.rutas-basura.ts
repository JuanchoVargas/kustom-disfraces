/**
 * CORTE TEMPRANO DE RUTAS DE ESCÁNERES. Los bots que buscan WordPress o secretos
 * piden a diario cosas como /wp-admin/install.php o /.env. Antes llegaban al SSR de
 * Nuxt: se inicializaba la app entera (plugins incluidos) para acabar en un 404 de
 * 68 kB, y con la instancia fría eso costaba lecturas a Neon.
 *
 * Este middleware corre ANTES de todo y responde 404 de texto plano, cacheable por el
 * CDN, sin tocar Nuxt ni la base. SOLO patrones que en este sitio no existen ni
 * existirán (no hay PHP, ni WordPress, ni CGI; WordPress vive en api.*, otro host):
 *
 *   *.php            cualquier ruta que termine en .php
 *   /wp-*            /wp-admin, /wp-login.php, /wp-content, /wp-includes, /wp-json…
 *   /xmlrpc.php      (ya cubierta por *.php; se lista por claridad)
 *   /.env            exactamente esa ruta
 *   /.git/*          cualquier cosa bajo /.git/
 *   /cgi-bin/*       cualquier cosa bajo /cgi-bin/
 *
 * Todo lo demás (/, /producto/*, /categoria/*, /checkout, /pago-*, /admin/*, /api/*,
 * /_nuxt/*, /images/*…) pasa sin cambios. scripts/test-rutas-basura.mjs lo verifica.
 */
export const RUTAS_BASURA: RegExp[] = [
  /\.php$/i,
  /^\/wp-/i,
  /^\/xmlrpc\.php$/i,
  /^\/\.env$/i,
  /^\/\.git\//i,
  /^\/cgi-bin\//i,
]

export function esRutaBasura(path: string): boolean {
  const limpio = (path || '/').split('?')[0]!.split('#')[0]!
  return RUTAS_BASURA.some(re => re.test(limpio))
}

export default defineEventHandler((event) => {
  if (!esRutaBasura(event.path)) return
  setResponseStatus(event, 404)
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  // El CDN absorbe las repeticiones: el mismo escáner no vuelve a despertar la función.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex')
  return 'Not found'
})
