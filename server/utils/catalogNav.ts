import navegacionData from '~~/app/data/navegacion.json'
import catalogoData from '~~/app/data/catalogo.json'

/**
 * Árbol de navegación (públicos → subcategorías) para el servidor, calculado como
 * en la web (app/composables/useCatalogNav.ts): solo se listan públicos y
 * subcategorías CON productos disponibles, para que el bot coincida con el sitio.
 *
 * Nota: se calcula desde catalogo.json local (taxonomía estable). En modo Woo la
 * disponibilidad podría variar; la estructura de públicos/subcategorías no.
 */

interface RawSub { slug: string, nombre: string, placeholder?: boolean }
interface RawPublico { slug: string, nombre: string, placeholder?: boolean, subcategorias: RawSub[] }
interface RawCatalogoItem { publicos?: string[], subcategoriaNav?: string | null, disponibleWeb?: boolean }

export interface NavSub { slug: string, nombre: string, count: number }
export interface NavPublico { slug: string, nombre: string, count: number, subcategorias: NavSub[] }

const nav = navegacionData as { publicos: RawPublico[] }
const catalogo = catalogoData as unknown as RawCatalogoItem[]

export function getPublicos(): NavPublico[] {
  const products = catalogo.filter(p => p.disponibleWeb === true)
  return nav.publicos
    .map((pub) => {
      const prods = products.filter(p => p.publicos?.includes(pub.slug))
      return {
        slug: pub.slug,
        nombre: pub.nombre,
        count: prods.length,
        // subs "por llenar" (placeholder, ej. Fantasía) no cuentan para mostrar
        // un público vacío: Combos sigue oculto hasta tener productos reales.
        rawSubs: pub.subcategorias.filter(s => !s.placeholder).length,
        subcategorias: pub.subcategorias
          .map(s => ({ slug: s.slug, nombre: s.nombre, count: prods.filter(p => p.subcategoriaNav === s.slug).length }))
          .filter(s => s.count > 0),
      }
    })
    // Se muestran los públicos con productos o con subcategorías en la taxonomía
    // (así Caballeros aparece como "muy pronto"), pero se oculta Combos (0 y 0),
    // igual que el navbar del sitio.
    .filter(pub => pub.count > 0 || pub.rawSubs > 0)
    .map(({ rawSubs, ...pub }) => pub)
}

export function getPublico(slug: string): NavPublico | undefined {
  return getPublicos().find(p => p.slug === slug)
}

/** Nombre del público aunque esté vacío (para textos), desde la taxonomía cruda. */
export function publicoNombre(slug: string): string | undefined {
  return nav.publicos.find(p => p.slug === slug)?.nombre
}

/** Nombre de una subcategoría dentro de un público (desde la taxonomía cruda). */
export function subNombre(publicoSlug: string, subSlug: string): string | undefined {
  return nav.publicos.find(p => p.slug === publicoSlug)?.subcategorias.find(s => s.slug === subSlug)?.nombre
}
