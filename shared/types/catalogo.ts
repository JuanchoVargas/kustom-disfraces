/**
 * Modelo de datos del catálogo según la codificación oficial del cliente
 * (CODIGOS DE REFERENCIAS.xlsx, en app/insumos/ — local-only).
 * 1 ítem = 1 referencia. Las ex "gamas dobles" del sitio son DOS ítems
 * enlazados por `parejaDe` (la vista los re-une vía shared/utils/catalogo).
 */

export type LineaCatalogo = 'disfraces' | 'chaquetas' | 'trajes-tipicos' | 'prendas'

export type GrupoCatalogo =
  | 'super'
  | 'economico'
  | 'semi'
  | 'anime'
  | 'trusa-adulto'
  | 'trusa-infantil'
  | 'super-adulto'
  | 'vestidos'
  | 'ninja'
  | 'peluche-plus'
  | 'peluche-linea'
  | 'chaqueta'
  /** Michael Jackson: no existe en la codificación oficial, pendiente cliente */
  | 'personajes'

export type PublicoCatalogo = 'bebes' | 'ninos' | 'ninas' | 'damas' | 'caballeros'

export interface ProductoCatalogo {
  /** SKU de 9 dígitos del Excel; sufijo -P = provisional, pendiente cliente. Clave única. */
  codigo: string
  /** Nombre para la web (ítems visibles) o nombre del catálogo (ocultos) */
  nombre: string
  /** Nombre tal cual aparece en el Excel del cliente (null si la ref no existe allí) */
  nombreCatalogo: string | null
  /** Etiqueta interna del cliente (columna ETIQ del Excel) */
  etiq: string | null
  linea: LineaCatalogo
  grupo: GrupoCatalogo
  /** Públicos donde aparece (los unisex van en ninos Y ninas). Chaquetas: [] (fuera de nav). */
  publicos: PublicoCatalogo[]
  /** Subcategoría del árbol de navegacion.json (null = sin ubicación aún) */
  subcategoriaNav: string | null
  tallas: (number | string)[]
  /** Precio COP — ⚠ PROVISIONAL (ver README). null = sin base aún, pendiente cliente. */
  precio: number | null
  /** Vacío = fotos pendientes del cliente */
  imagenes: string[]
  /** true = la foto es de figura ÚNICA (extraída del PDF, sin frente+espalda);
   *  los recortes "solo frontal" de la Home no le aplican */
  fotoIndividual?: boolean
  /** Solo los true se muestran en el sitio */
  disponibleWeb: boolean

  // --- presentación web (solo ítems visibles) ---
  /** id legacy estable (lo usa el carrito persistido) */
  idWeb?: number
  slug?: string
  descripcion?: string
  /** Descripción del acabado que muestra la PDP al elegir gama (super/economico) */
  descripcionGama?: string
  incluye?: string[]
  destacado?: boolean
  temporada?: string
  /** En ítems `economico`: código del ítem `super` con el que forma la ex "gama doble" */
  parejaDe?: string
}

export interface SubcategoriaNav {
  slug: string
  nombre: string
  /** Sin productos todavía (estructura lista) */
  placeholder?: boolean
  /** Ubicación pendiente de confirmar con el cliente */
  provisional?: boolean
  nota?: string
}

export interface PublicoNav {
  slug: string
  nombre: string
  placeholder?: boolean
  subcategorias: SubcategoriaNav[]
}

export interface NavegacionCatalogo {
  publicos: PublicoNav[]
}
