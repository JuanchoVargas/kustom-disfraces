# Kustom Disfraces — reglas del proyecto

Frontend headless (Nuxt 4 + Nitro en Vercel Hobby, Postgres en Neon, WooCommerce en
`api.disfraceskustom.com`). La documentación operativa completa vive en `README.md` y
en `docs/`; este archivo es el resumen de reglas que no se negocian. Fuente:
`docs/CONTEXTO.md` sección 6 (2026-09-16).

## Entornos: lo primero que hay que saber

- **Preview y Production comparten Neon, Woo y buzones: todo lo que corra en un
  Preview afecta producción.** Un webhook, un cron, una escritura del panel o un
  script apuntado a un Preview toca la misma base, la misma tienda y los mismos
  correos que producción. No hay base ni tienda "de preview".
- `npm run dev` apunta a la base de PRODUCCIÓN. **Todo test que escriba** corre con
  `npm run dev:test` sobre una rama de Neon marcada con la tabla `kustom_bd_pruebas`
  (`scripts/preparar-bd-pruebas.mjs`, guarda en `scripts/lib/guard-bd.mjs`). El
  2026-09-10 un test borró overrides reales de producción; de ahí la regla.
- Nunca borrar `inventory_changes`: es la bitácora que permite reconstruir el
  inventario si algo se pierde.
- No tocar variables de Vercel ni producción sin que el usuario lo pida explícitamente.

## Git y flujo de trabajo

- **Un commit por tarea aprobada**, mensaje descriptivo en español. `git add` solo
  con rutas explícitas; **nunca `git add -A`** (arrastró archivos ajenos el
  2026-07-04). Si aparece algo ajeno en el working tree, preguntar antes.
- Trabajo en rama `feature/*` o `fix/*` desde `master`. El push de la rama crea un
  Preview en Vercel. Merge a `master` (históricamente `--ff-only`) solo con OK.
- **Flujo con arquitecto**: el usuario revisa las decisiones técnicas con un revisor
  externo. Explicar cada decisión numerada y **esperar confirmación antes de pasos
  grandes** (dependencias nuevas, arquitectura de datos, versiones, commits).
- Tras cada push a `master`: `node scripts/verificar-deploy.mjs --esperar`. Si el
  hash de `/api/version` no coincide con `origin/master`, el deploy **no entró**.
  No reportar "desplegado" sin este check. Para un preview:
  `node scripts/verificar-deploy.mjs https://<preview>.vercel.app <rama>`.
- Vercel Hobby: **crons solo diarios** en `vercel.json`. Un cron horario rechaza el
  deploy entero en silencio (pasó dos veces).
- `CRON_SECRET` debe existir en Vercel **Production antes** de mergear código que la
  exija: los endpoints de cron son fail-closed (401 sin ella) y Vercel solo ejecuta
  los crons en el deployment de Production. En Preview es opcional (pruebas manuales).
- `NUXT_META_APP_SECRET` es obligatoria en Vercel **Production**; el orden es
  **variable primero, merge después**. El POST de `/api/whatsapp` valida la firma
  `X-Hub-Signature-256` y es fail-closed (401 sin la variable): sin ella el bot deja
  de contestar. `/api/messenger` está en modo observación (no rechaza, solo loguea
  `[meta-firma] … observación`) hasta confirmar si usa la misma app de Meta; si es
  otra, su secreto va en `NUXT_MESSENGER_APP_SECRET`.

## Seguridad y datos

- **Webhooks de Meta firmados**: todo POST a `/api/whatsapp` y `/api/messenger` pasa
  primero por `verificarFirmaMeta()` (`server/utils/metaFirma.ts`), que verifica el
  HMAC del cuerpo CRUDO; el handler parsea el JSON desde esos mismos bytes. Nunca
  usar `readBody` antes de verificar. `node scripts/test-firma-meta.mjs` lo cubre.
- **Rutas públicas sin base**: home, PLP, PDP y el 404 de un escáner no deben leer
  Neon. El estado de stock público sale de `getPublicStockState()` (sin base mientras
  el stock real no se aplique al sitio); `getStockState()` es solo del panel.
- Claves de Woo, Mercado Pago, Meta y SMTP **nunca al cliente**: viven en
  `runtimeConfig` server-only. Los precios se recalculan siempre en el servidor.
- **Logs sin datos personales**: ningún `console.*` imprime teléfono completo, nombre,
  dirección, correo ni texto del cliente. Identificadores solo con `maskId()` de
  `server/utils/logSafe.ts`; errores de Graph/Meta con `redactDigits()`. Ids de
  negocio (paymentId, SKU, product/variation id, orden) sí van completos.
  `node scripts/test-log-seguro.mjs` lo verifica y debe seguir en verde.
- `NUXT_DEBUG_PAYLOADS=true` registra solo la estructura de los webhooks (claves y
  tipos), nunca valores. Default `false`.
- WhatsApp: el único destino de pruebas es `WA_TEST_TO` (`.env.example`); la línea
  real del negocio **nunca** es destino de pruebas. Ningún número de teléfono va
  literal en código, docs ni commits.
- Escritura en Woo: la guarda `NUXT_INVENTORY_WOO_ONLY_DRAFTS` (+ lista de permitidos
  `NUXT_INVENTORY_WOO_ALLOW`, códigos de producto) se decide en `guardDraft()`. Ninguna
  prueba ni botón de diagnóstico escribe en un producto publicado. La llave de
  escritura de Woo solo vive en Vercel: nunca en `.env` local.
- El adaptador woo **relee Woo antes de escribir** y rechaza lo que cambió desde el snapshot
  (`conflictoConWoo`): el stock se escribe en absoluto y una venta intermedia lo inflaría.
  No añadir caminos de escritura a Woo que se salten `escribirLoteWoo`/`single`.
- Nunca correr `scripts/migrar-imagenes-woo.mjs` ni `scripts/aplicar-overrides-woo.mjs
  --aplicar` sin el usuario presente. No cambiar `NUXT_INVENTORY_BACKEND` a `woo`
  sin seguir `docs/inventario-activacion.md`. Las pruebas de inventario solo contra
  el adaptador `mock`.

## Pagos (Mercado Pago → Woo)

- La lógica del webhook vive en `server/utils/procesarPagoMp.ts` con dependencias
  inyectadas; el handler solo valida la firma y las arma. **Nada de "modo simulación"
  en el camino de producción**: se prueba con dobles (`scripts/test-pagos-mp.mjs`).
- Una orden por pago la garantiza la tabla `pagos_mp` (PRIMARY KEY), no la búsqueda en
  Woo. Sin base → 503. El umbral de "procesando vieja" (10 min) debe seguir siendo
  mayor que la duración máxima de la función en Vercel (5 min).
- La línea resuelta va a Woo **solo con `variation_id`** (nunca `sku` ni `product_id`:
  Woo prioriza el `sku` y guardaba `variation_id: 0`).
- `notification_url` siempre al dominio canónico, nunca al host de la petición.

## Dominio y catálogo

- DNS: el raíz y `www` apuntan **siempre** a Vercel; WordPress solo en `api.*`.
  Ningún wizard de Hostinger toca el raíz.
- No cambiar `DATA_SOURCE` a `woo` sin correr la verificación de paridad
  (`scripts/paridad-woo.mjs`).
- Reglas de marca: los patrones solo en sus lugares (crema en fondos, morado solo
  en el bloque KO, ink solo en el footer); fotos de producto siempre sobre blanco;
  sin promociones en la cinta de eslóganes.
- Talla `0` existe (bebés): validar tallas con `=== null`, nunca con truthiness.

## Pruebas

- No hay test runner ni `npm test`; son scripts en `scripts/`. Locales sin red ni
  BD (siempre ejecutables): `test-textos-bot`, `test-agotados-override`,
  `test-autor-panel`, `test-escritura-segura`, `test-sincronizacion`,
  `test-log-seguro`, `test-guarda-woo`, `test-restaurar-woo`, `test-agotado-stock-real`. `test-releer-woo` escribe en la rama de pruebas (snapshot y
  registro con SKU ficticios) y no necesita el servidor. Los que escriben exigen `npm run dev:test`; `test-pagos-mp` escribe
  directo en la rama de pruebas (candado `pagos_mp`) y no necesita el servidor.
- `npm run build` es la validación real antes de un push (es lo que corre Vercel).
- **Verificar el exit code del build antes de commitear, no solo lanzarlo.** El commit va
  encadenado al resultado (`npm run build && git commit …`, o comprobar `$?` y parar si no
  es 0); nunca separado con `;`. El 2026-09-17 una cadena cortada por un paso anterior hizo
  el commit sin que el build llegara a correr. Igual con las suites: se mira su exit code.
