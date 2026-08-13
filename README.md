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
entra al build): 66 visibles (`disponibleWeb: true` — **66 productos web**, porque
Súper y Línea Entrada son productos separados; los pares se enlazan con `parejaDe`
solo para el cruce de la PDP) y 43 ocultas sin foto ni precio confirmado (SEMI,
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
| Anime (conjuntos) | $130.000 |
| Ninjas | $80.000 |
| Personajes (Michael Jackson) | $120.000 |
| Trusas adultos | $150.000 |
| Bebés · Animales (Línea) | $89.000 |
| Bebés · Línea Plus (Stitch, Gato con Botas) | $110.000 |

**Corrección de cero faltante (confirmada por el cliente, jul 2026):** el Excel traía
Pantera Negra en $12.000 y los 5 anime Nezuko, Rengoku, Tanjiro, Tomioka y Zenitzu en
$13.000 (un cero de menos). El cliente confirmó los valores: Pantera Negra **$120.000**
y los 5 anime **$130.000** (ya cargados).

**Sin precio en el Excel:** Spider Gwen (trusa adulto, `001005010`) no aparece en la
lista de precios. Queda **oculta** (`disponibleWeb: false`, `precio: null`) hasta que el
cliente entregue su precio oficial.

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
| Kokushibo (anime) | `001004007-P` | ref nueva del Excel de precios; código libre (el `001004007` de Shinobu se reasignó). Precio confirmado $130.000, pero sigue **oculta** (`disponibleWeb: false`) hasta tener foto y código oficial |

El Excel confirma **"Ninja Dorada"** (001009003) — el nombre que se había asumido.

Supuestos de las 43 referencias ocultas (sin base en el sitio, revisar al activarlas):
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
- **Caché**: `defineCachedFunction` de Nitro, `maxAge` **2 min** y `swr: false`
  (revalidación síncrona: al expirar, la primera request de la ventana bloquea
  ~1-2s y trae datos frescos de Woo, en vez de servir stale). En serverless el
  `swr: true` revalidaba en background y esa tarea moría al devolver la respuesta,
  dejando datos viejos; por eso se desactivó. El hosting compartido recibe a lo
  sumo un refresco por ventana, no un hit por visita.

  > **Los cambios de precio/stock hechos en WooCommerce se reflejan en el sitio
  > en ~2 minutos** (ventana de caché del proxy). Es el comportamiento esperado
  > — no es un bug. Para propagación más rápida, bajar `maxAge` en
  > `server/utils/woo.ts` (a mayor costo de llamadas a Woo).
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

---

## 💳 Mercado Pago (Fase 1 — Checkout Pro, modo PRUEBA)

Pago adicional al de WhatsApp (que **sigue intacto** como alternativa). El botón
**"Pagar con Mercado Pago"** (drawer del carrito y página `/carrito`) pide al
servidor una **preferencia** con los ítems del carrito y redirige al comprador a
la pantalla de pago de Mercado Pago con el monto correcto.

**Arquitectura elegida:** redirect a la preferencia (Checkout Pro), no brick
embebido. Es lo más robusto para la Fase 1; un brick embebido "sin salir del
sitio" queda como posible Fase 2.

### Variables de entorno (van en `.env` local y en Vercel)

| Variable | Dónde | Qué es |
|---|---|---|
| `MP_ACCESS_TOKEN` | **Servidor (secreto)** | Access Token de PRUEBA. Crea la preferencia y verifica pagos en el webhook. En runtime: `NUXT_MP_ACCESS_TOKEN`. Empieza por `TEST-`. |
| `MP_PUBLIC_KEY` | **Frontend (público)** | Public Key de PRUEBA. Registrada y lista para un futuro brick del SDK; el flujo redirect actual **no la usa**. En runtime: `NUXT_PUBLIC_MP_PUBLIC_KEY`. Empieza por `TEST-`. |
| `MP_WEBHOOK_SECRET` | **Servidor (secreto)** | *(Fase 2, opcional)* Clave de firma del webhook. Si está, se valida `x-signature`. En runtime: `NUXT_MP_WEBHOOK_SECRET`. |

Se sacan de: **Mercado Pago → Tus integraciones → (tu app) → Credenciales de
prueba**. Sin `MP_ACCESS_TOKEN`, el endpoint responde `503 not_configured` y el
sitio sigue funcionando (queda WhatsApp).

- Endpoint: `server/api/checkout/mercadopago.post.ts` → `POST /api/checkout/mercadopago`.
- Frontend: composable `app/composables/useMercadoPago.ts`.

> ⚠️ **Antes de PRODUCCIÓN:** revalidar los precios contra el catálogo en el
> servidor (hoy llegan del carrito del cliente) y cambiar las credenciales
> `TEST-` por las de producción.

### Tarjetas de prueba (sandbox)

Usar cualquiera de estas. El **resultado** se controla con el **nombre del
titular**: `APRO` (aprobado), `OTHE` (rechazado), `CONT` (pendiente).
Documento (identificación): tipo **CC**, número **12345678**.

| Tarjeta | Número | CVV | Vencimiento |
|---|---|---|---|
| Mastercard | 5031 7557 3453 0604 | 123 | 11/30 |
| Visa | 4509 9535 6623 3704 | 123 | 11/30 |
| American Express | 3711 803032 57522 | 1234 | 11/30 |

(Los números de prueba pueden variar por país/cuenta; confirmar en el panel de
MP → Cuentas de prueba / Tarjetas de prueba si alguno no aplica.)

## 💳 Mercado Pago (Fase 2 — Webhook + páginas de resultado, sandbox)

Todo sigue en **modo PRUEBA**. La Fase 2 añade la confirmación server-to-server
del pago y las pantallas de retorno.

### Páginas de resultado (back_urls)

MP redirige al comprador tras el pago. Rutas (todas `noindex`), componente
compartido `app/components/checkout/PaymentResult.vue`:

| back_url | Ruta | Estado |
|---|---|---|
| success | `/pago-exitoso` | Aprobado — KO celebrando; **vacía el carrito** |
| failure | `/pago-fallido` | Rechazado/cancelado — ofrece reintentar o WhatsApp |
| pending | `/pago-pendiente` | En proceso — mensaje de espera |

> El estado que muestran estas páginas es **informativo** (viene de la URL de
> retorno). La confirmación **real** la da el webhook.

### Webhook — `server/api/webhooks/mercadopago.post.ts`

`POST /api/webhooks/mercadopago`. Al recibir la notificación, **no confía en el
body**: consulta `GET /v1/payments/{id}` en la API de MP con el Access Token para
leer el estado real (`approved` / `rejected` / `pending`…). Si `MP_WEBHOOK_SECRET`
está configurado, valida además la firma `x-signature` (HMAC-SHA256) y rechaza lo
no auténtico (401). Hoy verifica y **registra** el estado; el enganche para
persistir/confirmar el pedido queda marcado con un `TODO` (falta sistema de pedidos/BD).

El `notification_url` se arma solo con el origen de la request, así que apunta
automáticamente al dominio donde corre (Preview o prod). **En localhost no se
registra** (MP no puede alcanzarlo) → el webhook se prueba en un despliegue público.

### Cómo probar el webhook (Preview en Vercel)

1. Desplegar la rama `feature/pagos-mp` como **Preview** en Vercel.
2. En el entorno **Preview** de Vercel, definir las variables: `MP_ACCESS_TOKEN`,
   `MP_PUBLIC_KEY` (y opcional `MP_WEBHOOK_SECRET`) con credenciales de **prueba**.
   **No tocar producción.**
3. La preferencia ya manda `notification_url = https://<preview>.vercel.app/api/webhooks/mercadopago`
   automáticamente. Registrar esa misma URL en **MP → Tus integraciones → Webhooks**
   (evento *Pagos*) para tener el secreto de firma y las reentregas manuales.
4. Hacer un pago de prueba desde el Preview y verificar en los logs de Vercel la
   línea `[mp-webhook] pago <id>: approved …`.
