# Inventario — checklist de activación (mock → Woo)

Pasos exactos para el día en que se confirme que la llave de escritura de
WooCommerce funciona. Hasta entonces el módulo corre en **modo simulación**
(`NUXT_INVENTORY_BACKEND=mock`): lee productos reales de Woo y guarda los
cambios en Postgres sin tocar Woo ni el sitio.

## 0. Antes de empezar

- [x] Llave de escritura ("Checkout Orders v2", Read/Write) verificada desde Vercel el 2026-09-06 (7/7 pasos OK sobre un borrador).
- [ ] En Vercel crear `NUXT_WOO_WRITE_CONSUMER_KEY` / `NUXT_WOO_WRITE_CONSUMER_SECRET` con el mismo valor (nombre que refleja su uso real: órdenes + productos). Las antiguas `NUXT_WOO_ORDERS_*` se siguen leyendo como respaldo; retirarlas tras verificar un pago de prueba.
- [ ] Probar el adaptador desde el panel: botón **Probar escritura en Woo** (solo borradores). Debe terminar en "Adaptador woo OK".

## 1. Activar la gestión de stock en Woo

Hoy `manage_stock` está en **false en las 537 variaciones** (el ajuste global de
WooCommerce sí está activado). El adaptador lo enciende talla por talla al
escribir un stock, así que no hay que tocar nada masivo en WordPress. Si se
prefiere activarlo de golpe: en Woo → Productos → editar → Variaciones →
"¿Gestionar inventario?" (o hacerlo desde el panel con una operación masiva
de stock, siguiente entregable).

## 2. Cargar existencias iniciales

- [ ] Preparar el Excel de existencias por SKU de talla (`{codigo}-T{talla}`,
      ej. `001010001-T4`, `001010001-TBebé`).
- [ ] Importarlo desde el panel (importación con previsualización, siguiente
      entregable) o escribir los stocks en simulación y aplicarlos en el paso 4.

## 3. Aplicar lo hecho en simulación

Todo lo editado en modo mock vive en `inventory_overrides`. Se aplica a Woo con
vista previa "antes → después":

```bash
node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com            # solo muestra
node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com --aplicar  # escribe
```

Usa la contraseña del panel (`NUXT_INBOX_PASSWORD`) y el servidor de producción
(es el que tiene la BD con las sobreescrituras). Las aplicadas con éxito se
borran de `inventory_overrides`; las fallidas quedan y se listan.

## 4. Cambiar el adaptador

- [ ] Validar las operaciones masivas sobre borradores y entonces poner `NUXT_INVENTORY_WOO_ONLY_DRAFTS=false` en Vercel (hasta ahí el adaptador rechaza cualquier escritura a un publicado).

- [ ] En Vercel: `NUXT_INVENTORY_BACKEND=woo` y redeploy.
- [ ] Abrir `/admin/inventario`: la etiqueta debe decir **"Woo en vivo"** y el
      aviso amarillo de simulación debe desaparecer.
- [ ] Editar un precio en un borrador desde el panel y verlo en Woo.

## 5. Descuentos: apagar el descuento ficticio

⚠️ Al empezar a usar `sale_price` REAL en Woo hay que poner
`NUXT_PUBLIC_SHOW_DISCOUNT=false` en Vercel. Ese flag pinta un precio tachado
inventado (`useFakeDiscount`, +20 %) sobre el precio de venta; con oferta real
se duplicaría el descuento (tachado ficticio sobre un precio ya rebajado).

## 6. Verificar el descuento de inventario al confirmarse un pago

- [ ] Con `manage_stock` activo en una talla, hacer un pago de prueba (Mercado
      Pago sandbox) y confirmar que la orden creada en Woo descuenta esa talla.
- [ ] Revisar que `/admin/inventario` refleja el nuevo stock tras "Sincronizar".
- [ ] La validación de stock en el checkout (contra el adaptador) es un
      entregable posterior; hasta entonces el sitio no bloquea compras sin stock.

## 7. Después

- [ ] El proxy del catálogo público (`server/utils/woo.ts`) sigue leyendo precio y
      tallas de Woo cada 2 minutos; la lógica de agotado (talla en 0 no
      seleccionable, producto en 0 fuera del catálogo y del bot) llega en un
      entregable posterior.
- [ ] Mantener `scripts/test-inventario.mjs` en verde contra un dev server con
      `NUXT_INVENTORY_BACKEND=mock` (contra `woo` escribiría de verdad).
