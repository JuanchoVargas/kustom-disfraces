import type { NavegacionCatalogo } from '~~/shared/types/catalogo'
import navegacionData from '~/data/navegacion.json'

/**
 * Árbol de navegación por públicos (navegacion.json) cruzado con los productos
 * visibles. Categorías y subcategorías SIN productos se auto-ocultan (Combos,
 * Princesas, Semi…): cuando el catálogo las active (disponibleWeb: true)
 * aparecen solas, sin tocar UI.
 */

export interface NavSubcategoria {
  slug: string
  nombre: string
  count: number
}

export interface NavPublico {
  slug: string
  nombre: string
  count: number
  subcategorias: NavSubcategoria[]
}

const nav = navegacionData as NavegacionCatalogo

export const useCatalogNav = () => {
  const { products } = useProducts()

  const publicos: NavPublico[] = nav.publicos
    .map((pub) => {
      const prods = products.filter(p => p.publicos?.includes(pub.slug))
      return {
        slug: pub.slug,
        nombre: pub.nombre,
        count: prods.length,
        subcategorias: pub.subcategorias
          .map(s => ({
            slug: s.slug,
            nombre: s.nombre,
            count: prods.filter(p => p.subcategoriasNav?.includes(s.slug)).length,
          }))
          .filter(s => s.count > 0),
      }
    })
    .filter(pub => pub.count > 0)

  const publicoBySlug = (slug: string) => publicos.find(p => p.slug === slug)

  return { publicos, publicoBySlug }
}
