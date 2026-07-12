# Kustom Disfraces — Frontend

Tienda headless de disfraces (Bogotá). **Nuxt 4 + TypeScript**, SSR/SSG, Pinia, @nuxt/image, @nuxt/fonts, VueUse. CSS con variables nativas (design system en `app/assets/css/tokens.css`).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # build de producción
npm run generate # SSG estático
```

## Estructura

```
app/
  assets/css/      tokens.css (design system) · main.css (reset)
  components/      ui/ · layout/ · product/ · category/ · home/
  composables/     useSiteNav.ts · useProducts.ts   <-- fuente de datos
  data/            catalogo.json (canónico: codificación oficial del cliente, 1 ítem = 1 referencia)
                   navegacion.json (árbol públicos/subcategorías, aún sin UI) · categories.json
                   (precios provisionales, ver abajo)
  insumos/         fuentes del cliente (PDF/Excel/imágenes) — LOCAL-ONLY: fuera del git (.gitignore), no se publican ni entran al build; respaldar por fuera del repo
  layouts/         default.vue (navbar + trust + footer)
  pages/           index · categoria/[slug] · producto/[slug] · carrito · design-system · preview
  stores/          cart.ts (Pinia)
server/api/        proxy a WooCommerce (oculta las API keys)  <-- Fase D
shared/
  types/woo.ts     Product · Category · CartItem
  utils/format.ts  formatCOP()
```

---

## 🎨 Regla de marca: patrones (dónde va cada tile)

Los tres tiles de `public/images/` tienen usos cerrados. Si un patrón aparece
fuera de su lugar, es un bug.

> **Actualización 2026-07-12 (decisión del cliente):** el fondo crema
> texturizado se extendió a TODO el sitio (Homepage + PLP + PDP + carrito),
> con la misma `--pattern-opacity` de siempre (NO subirla). La regla anterior
> ("PLP/PDP/carrito sin patrón") queda derogada.

| Patrón | Uso permitido | Cómo |
|---|---|---|
| `pattern-crema` | **Global: Homepage, PLP, PDP y carrito** (desde 2026-07-12) | utilidad `.textured` (main.css) en la raíz de cada página, intensidad vía `--pattern-opacity` (tokens.css) — sin subirla |
| `pattern-morado` | **Banda KO de la Homepage + estados especiales donde aparece KO** (404/500 en `error.vue`, carrito vacío en `carrito.vue`) | tile opaco del pack, intensidad de fábrica |
| `pattern-ink` | **Solo el footer** | tile opaco del pack, intensidad de fábrica |

**Sigue intacto**: las fotos de producto mandan — cards, galerías de la PDP y
filas del carrito van SIEMPRE sobre blanco sólido; la textura vive solo en el
fondo de página. El morado de los estados especiales acompaña a KO en su
card/bloque — nunca tiñe la página completa.

---

## 🧭 Navegación por públicos (nueva taxonomía)

El navbar (desktop con desplegables, mobile con menú acordeón + chips), las
CategoryTabs y la PLP navegan por los **públicos** de `navegacion.json`:
Bebés · Niños · Niñas · Damas · Caballeros · Combos. Decisiones:

- **Subcategoría por query param**: `/categoria/ninos?sub=trusas`. URL
  compartible, las tabs siguen siendo rutas y un `sub` desconocido equivale a
  "Todos". El contador de la PLP refleja el filtro activo.
- **Auto-ocultado**: públicos y subcategorías sin productos visibles (Combos,
  Princesas, Semi, vestidos de dama…) no aparecen en la navegación y la PLP
  del público vacío responde 404 — cuando el catálogo los active
  (`disponibleWeb: true`) aparecen solos, sin tocar UI (`useCatalogNav`).
- **Súper y Línea Entrada son productos SEPARADOS** (decisión del cliente,
  jul 2026): cada uno con su card, PDP, precio y tallas ("Thor" $129.900 y
  "Thor Línea Entrada" $89.900). No hay selector de gama: la PDP muestra un
  enlace cruzado discreto entre pares (`pareja` en el adaptador, vía
  `parejaDe` del catálogo). El filtro lateral "Gama" se eliminó (redundante
  con los chips de subcategoría).
- **PROVISIONAL — `/categoria/adultos` → 301 → `/categoria/damas`**
  (routeRules en `nuxt.config.ts`): la antigua categoría se dividió en
  damas/caballeros; se redirige al público con más catálogo hoy. Revisar
  cuando caballeros crezca o exista una página puente. Home y footer ya
  usan los 5 públicos; la redirección queda para enlaces externos viejos.

## ⚠️ Datos reales con PRECIOS PROVISIONALES

`app/data/catalogo.json` contiene las **108 referencias** de la codificación oficial
del cliente (`CODIGOS DE REFERENCIAS.xlsx` en `app/insumos/`, que NO se publica ni
entra al build): 67 visibles (`disponibleWeb: true` — **67 productos web**, porque
Súper y Línea Entrada son productos separados; los pares se enlazan con `parejaDe`
solo para el cruce de la PDP) y 41 ocultas sin foto ni precio confirmado (SEMI,
Súper Adulto, vestidos dama, chaquetas…). El sitio solo muestra `disponibleWeb: true`.
Dos salvedades que hay que resolver con el cliente antes de salir a producción:

### 1. Los precios son PROVISIONALES (inventados para diseño)

Ni el catálogo PDF ni el Excel traen precios (el catálogo remite a "Cotiza aquí" por
WhatsApp). Se cargaron precios de relleno, planos por tipo de producto:

| Tipo | Precio provisional |
|---|---|
| Súper Acolchado (gama) | $129.900 |
| Línea Eco (gama) | $89.900 |
| Vestidos superheroínas | $119.900 |
| Trusas infantiles | $99.900 |
| Anime (conjuntos) | $139.900 |
| Ninjas | $109.900 |
| Personajes (Michael Jackson) | $129.900 |
| Trusas adultos | $119.900 |
| Bebés · Animales | $79.900 |
| Bebés · Línea Plus (Stitch, Gato con Botas) | $89.900 |

Cuando llegue la lista oficial, se reemplazan en `catalogo.json` (campo `precio` de
cada referencia). No hay `regularPrice` (no se inventaron descuentos).

También es provisional el **umbral de envío gratis** del drawer del carrito:
`FREE_SHIPPING_THRESHOLD = 200_000` COP en `app/stores/cart.ts` — confirmar con el cliente.

### 2. Códigos provisionales (sufijo `-P`) — estado tras el Excel oficial (jul 2026)

La codificación oficial (`CODIGOS DE REFERENCIAS.xlsx`) resolvió 3 de los 7
provisionales originales y obligó a reasignar otros:

**Resueltos (ya con código real):**

| Producto | Antes | Ahora |
|---|---|---|
| Shinobu (anime) | `001004007-P` | `001004005` |
| Katrina (trusa adulto) | `001005012-P` | `001005006` |
| Gato con Botas (bebés) | `001011007-P` | `001010001` (pasa al grupo Animales Plus) |

**Siguen provisionales — confirmar con el cliente:**

| Producto | Código provisional | Situación |
|---|---|---|
| Capitana América (vestido) | `001008009-P` (antes `001008004-P`) | no está en el Excel; su antiguo provisional chocaba con Merlina real (`001008004`) |
| Michael Jackson | `001004008-P` (antes `001004005`) | no está en el Excel; su antiguo código real es de Shinobu. Grupo `personajes` tampoco existe en la codificación |
| Stitch (bebés) | `001010002-P` (antes `001011006-P`) | no está en el Excel; movido a la familia Animales Plus (010), que es su grupo real |
| Lady Bug (trusa infantil) | `001006004-P` | no está en el Excel (Trusa Infantil solo trae 3 refs) |
| Elastic Girl (trusa infantil) | `001006005-P` | no está en el Excel |

El Excel confirma **"Ninja Dorada"** (001009003) — el nombre que se había asumido.

Supuestos de las 41 referencias ocultas (sin base en el sitio, revisar al activarlas):
tallas de SEMI heredadas de Línea Eco; tallas de vestidos dama `S–XL`; precio `null`
en SEMI, Súper Adulto y chaquetas (sin grupo equivalente del cual heredar); chaquetas
sin tallas ni público asignado (fuera de la navegación).

Otras notas de la carga:
- **Líneas Súper / Entrada**: en `catalogo.json` Súper Acolchado y Línea Entrada
  (la antigua "Línea Eco") son DOS referencias y DOS productos web (cada una con
  su `codigo`, `precio`, `tallas` — SA tiene talla 0, Entrada no — e imagen);
  el ítem de Entrada apunta a su par con `parejaDe` para el enlace cruzado de la
  PDP (12 héroes en ambas líneas). El "Venom" de la Línea Entrada (001002004)
  corresponde por foto al **Venom Negro**.
- **Unisex**: ninjas, Michael Jackson y Esqueleto infantil viven en `ninos` Y `ninas`
  (campo `categorySlugs`).
- **Fotos**: 63 salen del Excel (800×800). Batman SA, Batman Eco, Gokú y Spider Gwen
  no tienen foto en el Excel: se extrajeron del PDF del catálogo (menor resolución,
  ~300–500px — pedir al cliente las fotos originales de esos 4).

## 🔌 Conexión con WooCommerce (Fase D)

> El frontend está construido contra el tipo de dominio `Product`/`Category` (`shared/types/woo.ts`).
> Las vistas (Home, PLP, PDP, carrito) **no cambian**: solo cambia de dónde salen los datos.

### Punto único a cambiar: `app/composables/useProducts.ts`

**Hoy** lee de un JSON local (el canónico `catalogo.json`, adaptado a la forma
legacy `Product` con `catalogoToProducts`):

```ts
import { catalogoToProducts } from '~~/shared/utils/catalogo'
import catalogoData from '~/data/catalogo.json'
import categoriesData from '~/data/categories.json'

const products = catalogoToProducts(catalogoData as unknown as ProductoCatalogo[])

export const useProducts = () => {
  const categories = categoriesData as Category[]
  // ...
}
```

**En Fase D** se reemplaza por un fetch al proxy del servidor (que es quien habla con Woo):

```ts
export const useProducts = async () => {
  const { data: products } = await useFetch<Product[]>('/api/products')
  const { data: categories } = await useFetch<Category[]>('/api/categories')
  // mismas funciones derivadas (featured, byCategory, bySlug…)
}
```

(Los componentes ya consumen `Product`, así que no se tocan.)

### El proxy: `server/api/` + claves seguras

Las API keys de WooCommerce **NUNCA** van al cliente. Viven en `runtimeConfig`
(server-only) en `nuxt.config.ts` y se inyectan por variables de entorno:

```
# .env (no se commitea)
NUXT_WOO_BASE_URL=https://tienda-del-cliente.com
NUXT_WOO_CONSUMER_KEY=ck_xxx
NUXT_WOO_CONSUMER_SECRET=cs_xxx
```

El endpoint `server/api/products.get.ts` (plantilla incluida) las usa para
llamar a la REST API de Woo (`/wp-json/wc/v3/products`), mapea la respuesta al
tipo `Product` y la devuelve al cliente — sin exponer nunca las llaves.

### Checklist Fase D
1. Crear `.env` con las 3 variables `NUXT_WOO_*`.
2. Completar el mapeo Woo → `Product` en `server/api/products.get.ts` y `categories.get.ts`.
3. Cambiar `useProducts.ts` de import JSON a `useFetch('/api/...')`.
4. (Opcional) Borrar `app/data/*.json`.

### Pendientes Fase D
- **Wishlist**: UI existente pero oculta (`ENABLE_WISHLIST = false` en
  `ProductCard.vue`); falta store Pinia con persistencia (análogo al carrito)
  y página de favoritos.

Nada más: el resto del frontend ya está listo.
