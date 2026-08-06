/**
 * Sitemap XML dinámico para Google.
 * Incluye: home, las 6 categorías, las páginas de info y los productos
 * VISIBLES (disponibleWeb). NO incluye productos ocultos, /carrito ni
 * /mayoristas (esos llevan noindex por página).
 *
 * CATALOGO_LOCAL se auto-importa desde server/utils/woo.ts.
 */
const CATEGORIES = ['bebes', 'ninos', 'ninas', 'damas', 'caballeros', 'combos']
const INFO = ['sobre-nosotros', 'como-comprar', 'envios', 'devoluciones', 'faq', 'politica-datos']

export default defineEventHandler((event) => {
  const site = useRuntimeConfig().public.siteUrl.replace(/\/+$/, '')

  const productPaths = CATALOGO_LOCAL
    .filter(p => p.disponibleWeb && p.slug)
    .map(p => `/producto/${p.slug}`)

  const paths = [
    '/',
    ...CATEGORIES.map(c => `/categoria/${c}`),
    ...INFO.map(i => `/${i}`),
    ...productPaths,
  ]

  const urls = paths
    .map(p => `  <url><loc>${site}${p}</loc></url>`)
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${urls}\n`
    + `</urlset>\n`

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return xml
})
