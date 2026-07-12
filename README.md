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
fuera de su lugar, es un bug (ya pasó una vez: una tarea metió `.textured` en
PLP/PDP/carrito/error y hubo que revertirlo).

| Patrón | Uso permitido | Cómo |
|---|---|---|
| `pattern-crema` | **Solo secciones de la Homepage** | utilidad `.textured` (main.css), intensidad vía `--pattern-opacity` (tokens.css) |
| `pattern-morado` | **Banda KO de la Homepage + estados especiales donde aparece KO** (404/500 en `error.vue`, carrito vacío en `carrito.vue`) | tile opaco del pack, intensidad de fábrica |
| `pattern-ink` | **Solo el footer** | tile opaco del pack, intensidad de fábrica |

**PLP, PDP y carrito/checkout van SIN patrón, siempre**: fondo Blanco Hueso
sólido (`--hueso`). Las fotos de producto mandan; el fondo no compite con ellas.
El morado de los estados especiales acompaña a KO en su card/bloque — nunca
tiñe la página completa (el carrito CON ítems va limpio).

---

## ⚠️ Datos reales con PRECIOS PROVISIONALES

`app/data/catalogo.json` contiene las **108 referencias** de la codificación oficial
del cliente (`CODIGOS DE REFERENCIAS.xlsx` en `app/insumos/`, que NO se publica ni
entra al build): 67 visibles (`disponibleWeb: true` — los 55 productos del sitio; las
ex "gamas dobles" son dos ítems enlazados por `parejaDe` que la vista re-une vía
`shared/utils/catalogo.ts`) y 41 ocultas sin foto ni precio confirmado (SEMI,
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
- **Gamas**: en `catalogo.json` Súper Acolchado y Línea Eco son DOS referencias
  (cada una con su `codigo`, `precio`, `tallas` — SA tiene talla 0, Eco no — e
  imagen); el ítem Eco apunta a su par con `parejaDe` y la PDP los muestra como un
  producto con selector de gama (12 héroes en ambas). El "Venom" de la Línea Eco
  (001002004) corresponde por foto al **Venom Negro**.
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
