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
                   (precios oficiales del cliente, ver abajo)
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

## 💲 Precios oficiales del cliente (cargados jul 2026)

`app/data/catalogo.json` contiene las **109 referencias** de la codificación oficial
del cliente (`CODIGOS DE REFERENCIAS.xlsx` en `app/insumos/`, que NO se publica ni
entra al build): 67 visibles (`disponibleWeb: true` — **67 productos web**, porque
Súper y Línea Entrada son productos separados; los pares se enlazan con `parejaDe`
solo para el cruce de la PDP) y 42 ocultas sin foto ni precio confirmado (SEMI,
Súper Adulto, vestidos dama, chaquetas…). El sitio solo muestra `disponibleWeb: true`.

### 1. Los precios son los REALES de la lista del cliente

Los `precio` de `catalogo.json` provienen de `DISFRACES PRECIOS.xlsx`
(`app/insumos/`, local-only). Cada valor sale de una celda del Excel — no hay precios
inventados. No hay `regularPrice` (la lista no trae descuentos). Precios por grupo:

| Tipo | Precio oficial |
|---|---|
| Súper Acolchado | $120.000 (Iron Spider-Man, Spider-Man Clásico, Miles Morales y Batman $130.000; Aquaman $99.000) |
| Línea Entrada | $65.000 |
| Vestidos superheroínas (niña) | $85.000 |
| Trusas infantiles | Spider Gwen y Elastic Girl $80.000 · Katrina y Esqueleto $70.000 · Lady Bug $65.000 |
| Anime (conjuntos) | Shinobu $130.000 (resto **pendiente**, ver abajo) |
| Ninjas | $80.000 |
| Personajes (Michael Jackson) | $120.000 |
| Trusas adultos | $150.000 |
| Bebés · Animales (Línea) | $89.000 |
| Bebés · Línea Plus (Stitch, Gato con Botas) | $110.000 |

**Pendientes de confirmación (NO actualizados — el Excel trae un cero de menos):**
Pantera Negra (Excel $12.000, debería ser ~$120.000) y los 5 anime Nezuko, Rengoku,
Tanjiro, Tomioka y Zenitzu (Excel $13.000, debería ser ~$130.000). Conservan su precio
anterior hasta que el cliente confirme el valor.

**Sin precio en el Excel:** Spider Gwen (trusa adulto, `001005010`) está visible pero
no aparece en la lista de precios; conserva su cifra anterior ($119.900) a la espera de
decisión (definir precio u ocultar).

**Grupos sin precio oficial** (siguen ocultos, `disponibleWeb: false`): SEMI, Súper
Adulto y chaquetas (`precio: null`); vestidos dama (no están en el Excel; conservan una
cifra heredada, no oficial — no se muestran). Se resuelven cuando el cliente los active.

El **umbral de envío gratis** del drawer del carrito
(`FREE_SHIPPING_THRESHOLD = 200_000` COP en `app/stores/cart.ts`) sigue por confirmar
con el cliente — es un ajuste de logística, no un precio de producto.

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
| Kokushibo (anime) | `001004007-P` | ref nueva del Excel de precios; código libre (el `001004007` de Shinobu se reasignó). Oculta, sin precio confirmado |

El Excel confirma **"Ninja Dorada"** (001009003) — el nombre que se había asumido.

Supuestos de las 42 referencias ocultas (sin base en el sitio, revisar al activarlas):
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

## 🔌 Conexión con WooCommerce (Fase D — IMPLEMENTADA, en modo local)

> WooCommerce vive en `api.disfraceskustom.com` (headless; el raíz y `www`
> apuntan SIEMPRE a Vercel). Las vistas no cambian según el origen de datos.

### Flag de origen: `DATA_SOURCE=local|woo` (.env)

- **`local` (default actual)**: el catálogo sale de `app/data/catalogo.json`.
- **`woo`**: el plugin `app/plugins/catalogo.ts` trae el catálogo del proxy
  `/api/products` durante el SSR y lo hidrata al cliente (`useState`);
  `useProducts` sigue síncrono y la UI no se entera del cambio.

⚠️ **NO cambiar a `woo` sin correr la verificación de paridad** (abajo) y
revisar el resultado. En Vercel el flag runtime es `NUXT_PUBLIC_DATA_SOURCE`.

### El proxy: `server/api/products` (+ `/api/products/<slug>`, `?categoria=`)

Las API keys **NUNCA** van al cliente: viven en `runtimeConfig` server-only,
alimentadas por `.env` (`WOO_API_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`;
en runtime se pueden sobreescribir con `NUXT_WOO_BASE_URL`, `NUXT_WOO_CONSUMER_KEY`,
`NUXT_WOO_CONSUMER_SECRET`).

- **Adaptador** (`server/utils/woo.ts`): merge por SKU — Woo es la autoridad
  COMERCIAL (publish/draft, precio, tallas, nombre, destacado) y el catálogo
  local aporta la taxonomía web (públicos, subcategorías, slugs, descripciones,
  pareja). Las **imágenes se sirven del propio frontend**, no de WordPress.
  Draft o sin producto en Woo ⇒ `disponibleWeb: false` (paridad con el modelo).
- **Caché**: `defineCachedFunction` de Nitro con SWR de **10 min** — el hosting
  compartido recibe a lo sumo un refresco por ventana, no un hit por visita.
- **Fallback**: si Woo no responde, el proxy loggea el incidente y sirve el
  catálogo local — el sitio nunca se cae por culpa de la API.

### Verificación de paridad (antes del switch)

```bash
npm run build && node .output/server/index.mjs   # terminal 1
node scripts/paridad-woo.mjs http://localhost:3000  # terminal 2
```

Compara visibles local vs Woo: mismos slugs, precios y tallas. Sale con código
0 solo si hay paridad total.

### Pendientes Fase D
- **Wishlist**: UI existente pero oculta (`ENABLE_WISHLIST = false` en
  `ProductCard.vue`); falta store Pinia con persistencia (análogo al carrito)
  y página de favoritos.

Nada más: el resto del frontend ya está listo.
