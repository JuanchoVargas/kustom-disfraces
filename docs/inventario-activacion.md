# Inventario — guía de activación (mock → WooCommerce)

Estado al 2026-09-07: el panel `/admin/inventario` está en producción en **modo
simulación** (`NUXT_INVENTORY_BACKEND=mock`). Lee los productos reales de Woo y
guarda los cambios en Postgres sin tocar Woo ni el sitio. El adaptador de
escritura ya está probado desde Vercel sobre borradores (escritura, relectura,
reversión, batch y guarda). Falta pasarlo a real, con los datos cargados antes.

> ⚠️ **El riesgo que hay que tener presente en todo momento**
> Con la gestión de stock activa, una talla con cantidad 0 **desaparece del
> selector** y un producto con todas sus tallas en 0 **sale del catálogo de la
> web y del bot**. Activar la gestión sin haber cargado las existencias reales
> equivale a vaciar la tienda. Por eso el orden es **datos primero, activación
> después**, y cada paso tiene una verificación antes de seguir.

## A. La clave REST dedicada (lo hace Juan Diego, con acceso a WordPress)

1. WordPress → **WooCommerce → Ajustes → Avanzado → REST API → Añadir clave**.
2. Descripción: `Inventario Kustom (panel)`. Usuario: el administrador.
   Permisos: **Lectura/Escritura**. Generar.
3. Copiar **Consumer key** y **Consumer secret** en ese momento: Woo no los
   vuelve a mostrar.
4. En Vercel → Proyecto → Settings → Environment Variables, entorno
   **Production** (y Preview si se quiere probar antes):

   | Variable | Valor |
   |---|---|
   | `NUXT_WOO_WRITE_CONSUMER_KEY` | la consumer key nueva (`ck_…`) |
   | `NUXT_WOO_WRITE_CONSUMER_SECRET` | el consumer secret nuevo (`cs_…`) |

   Las antiguas `NUXT_WOO_ORDERS_CONSUMER_KEY/_SECRET` se dejan **tal cual por
   ahora**: el código prefiere las `WRITE` y cae a las `ORDERS` si faltan, así
   el checkout no se rompe en ningún momento. Se retiran en el paso C.
5. **Redeploy** (Vercel → Deployments → Redeploy del último) para que tome las
   variables.
6. Verificar: abrir `/admin/inventario` → **Probar escritura en Woo**. El primer
   paso debe decir `origen: NUXT_WOO_WRITE_*` (ya no "respaldo") y la
   conclusión "Adaptador woo OK sobre borradores".

## B. Checklist de activación, en orden estricto

Convención: **[L]** lo hace Lesly desde el panel · **[JD]** lo hace Juan Diego
(Vercel, WordPress o terminal). No se pasa al siguiente paso sin cumplir la
verificación del anterior.

### B1. Preparar los datos (todavía en simulación; nada llega a Woo)

- [ ] **[JD]** Confirmar en `/admin/inventario` que la etiqueta dice
      **SIMULACIÓN** y que `NUXT_INVENTORY_PUBLIC_STOCK` no está definida en
      Vercel (o está en `auto`). Verificación: la franja amarilla "Modo
      simulación" está visible.
- [ ] **[L]** Exportar el inventario: botón **Exportar Excel**. Se descarga
      `inventario-kustom-<fecha>.xlsx` con una fila por talla (537).
- [ ] **[L]** Rellenar en ese Excel la columna **Stock** con las existencias
      reales de **cada talla** (número entero; 0 si de verdad no hay). Las
      columnas de precio se pueden dejar como están. No borrar ni renombrar
      columnas; no tocar la columna SKU.
      Verificación: ninguna talla de un producto publicado queda vacía por
      olvido. Una celda vacía = "no tocar" (esa talla seguiría sin gestión y
      se vendería sin límite).
- [ ] **[L]** Importar: botón **Importar** → elegir el Excel → **Previsualizar**.
      Revisar la pantalla antes → después: el resumen debe mostrar
      "N con cambios" y **0 con error**. Si hay errores (SKU inexistente,
      número inválido), corregir el Excel y volver a importar.
- [ ] **[L]** **Aplicar**. Verificación: la cabecera pasa a mostrar "N tallas
      con cambios pendientes" y la franja "⚠ Alertas de stock" refleja las
      tallas en 0 y las bajas. **Nada de esto se ve aún en la web** (sigue en
      simulación).
- [ ] **[JD]** Revisar el resultado con la vista previa del script (no escribe):
      ```
      node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com
      ```
      Verificación: la lista "ANTES (Woo) → DESPUÉS" coincide con lo que Lesly
      cargó, sin filas con error.

### B2. Red de seguridad antes de tocar la web

- [ ] **[JD]** Anotar cuántos productos publicados hay en la web ahora mismo
      (108 en Woo, 66 publicados; PLP de Niños, Niñas, Bebés y Damas) para
      compararlo después.
- [ ] **[JD]** Tener a mano el plan de reversión: poner
      `NUXT_INVENTORY_PUBLIC_STOCK=off` en Vercel y redeploy devuelve la web,
      el bot y el checkout a "todo disponible" en minutos, sin tocar Woo.

### B3. Escribir en Woo: primero UN producto, luego el resto

- [ ] **[JD]** Copia de seguridad fechada del catálogo completo. El script la
      hace sola con `--aplicar` (descarga el Excel de las 537 tallas con los
      valores actuales en `backups/inventario-<fecha>.xlsx` y no escribe nada
      si la descarga falla). Guardar ese archivo fuera del repo (Drive). Para
      revertir cualquier cosa: Importar ese Excel en el panel → Previsualizar →
      Aplicar → volver a correr el script.
- [ ] **[JD]** Primera ejecución real sobre **un solo producto en borrador**
      (por ejemplo SPIDERMAN CLASICO SEMI, `001003001`):
      ```
      node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com --sku 001003001
      node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com --sku 001003001 --aplicar
      ```
      La primera línea muestra solo las tallas de ese producto; la segunda las
      escribe. Verificación: "fallidas: 0"; en WordPress → Productos → ese
      producto → Variaciones, cada talla cargada tiene "¿Gestionar inventario?"
      activo y la cantidad correcta.
- [ ] **[JD]** Si quedó bien, el resto de borradores y después los publicados:
      ```
      node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com --estado draft --aplicar
      node scripts/aplicar-overrides-woo.mjs https://www.disfraceskustom.com --estado publish --aplicar
      ```
      Cada ejecución hace su propia copia de seguridad. Verificación:
      "fallidas: 0" y "pendientes en total: 0". Si falla alguna, queda listada
      con su motivo y se repite el comando: solo reintenta las que faltan.
- [ ] **[JD]** Verificar en WordPress dos o tres productos publicados al azar.

### B4. Encender el adaptador real

- [ ] **[JD]** En Vercel: `NUXT_INVENTORY_BACKEND=woo` y **mantener**
      `NUXT_INVENTORY_WOO_ONLY_DRAFTS=true` de momento. Redeploy.
- [ ] **[JD]** Abrir `/admin/inventario`: la etiqueta debe decir **Woo en vivo**
      y aparecer la franja azul "solo borradores".
- [ ] **[L]** Cambiar el stock de una talla de un **borrador** (por ejemplo
      SPIDERMAN CLASICO SEMI) y guardar. Verificación: destello verde y el
      cambio aparece en WordPress en ese producto.
- [ ] **[L]** Intentar cambiar una talla de un **publicado**. Verificación: la
      fila muestra "bloqueado: el adaptador woo solo escribe en BORRADORES".
      Eso confirma que la guarda funciona.

### B5. Abrir la escritura a publicados y activar el stock en la web

Este es el paso que **cambia lo que ven los clientes**. Solo cuando B1 a B4
estén verificados.

- [ ] **[JD]** En Vercel: `NUXT_INVENTORY_WOO_ONLY_DRAFTS=false`. Redeploy.
      (`NUXT_INVENTORY_PUBLIC_STOCK` se deja en `auto`: con adaptador `woo` el
      stock se aplica solo.)
- [ ] **[JD]** Verificación inmediata, en este orden:
      1. `https://www.disfraceskustom.com/api/stock` responde `enabled: true`;
         los `agotados` deben ser **solo** los productos que Lesly dejó con
         todas las tallas en 0. Si la lista es larga o inesperada, **revertir**
         (B2) y revisar el Excel.
      2. Las cuatro PLP muestran los mismos productos que antes salvo los
         agotados a propósito.
      3. En una PDP, una talla con stock 0 aparece deshabilitada; las demás,
         seleccionables.
      4. Desde el celular de pruebas, pedirle al bot un producto con una talla
         en 0 (por ejemplo "batman talla 12" si la 12 quedó en 0): debe
         responder "⚠️ Talla 12 no disponible" y listar solo las tallas con
         existencias.
      5. Carrito con una talla en 0 → el checkout responde "Algunas tallas ya
         no tienen existencias" y no crea la preferencia de pago.
- [ ] **[L]** Desde ese momento el panel escribe directo en Woo: cada cambio
      llega a la web en menos de 2 minutos y las alertas de stock bajo van a
      ventas@ (al cruzar el umbral y en el resumen diario de 7:30 a.m.).

### B6. Descuento en el sitio

- [ ] **[JD]** El día que se use **precio rebajado** real en el panel, poner
      `NUXT_PUBLIC_SHOW_DISCOUNT=false` en Vercel y redeploy. Ese flag pinta un
      precio tachado ficticio (+20 %) sobre el precio de venta; con oferta real
      se duplicaría el descuento.

### B7. Descuento de inventario al vender

- [ ] **[JD]** Hacer un pago de prueba en Mercado Pago (sandbox) de una talla
      con stock gestionado. Verificación: la orden en Woo descuenta esa talla y,
      tras "Sincronizar con Woo" en el panel, la cantidad bajó en uno. Si Woo
      no descuenta, revisar en WooCommerce → Ajustes → Inventario que
      "Gestionar inventario" esté activo (hoy lo está) y que la orden se haya
      creado en estado "procesando" o "completado".

## C. Limpieza (una semana después, con todo estable)

- [ ] **[JD]** Retirar `NUXT_WOO_ORDERS_CONSUMER_KEY/_SECRET` de Vercel y
      redeploy. Verificar un pago de prueba y una escritura del panel. Luego
      quitar la lectura de respaldo en `server/utils/wooWrite.ts`.
- [ ] **[JD]** Ajustar `NUXT_INVENTORY_STOCK_BAJO` si 5 unidades por talla no
      es el umbral que quiere la clienta.

## D. Qué está probado y qué no

| Pieza | Estado |
|---|---|
| Llave de escritura desde Vercel (PUT, relectura, reversión, batch) | Probado el 2026-09-06 sobre borradores |
| Adaptador woo por el camino real del módulo + guarda de borradores | Probado el 2026-09-06 en el preview |
| `aplicar-overrides-woo.mjs`, vista previa antes → después | Probado el 2026-09-07 con sobreescrituras reales; tabla correcta y sin escribir |
| Subconjunto `--sku` (producto o talla), `--estado`, `--limite` | Probado el 2026-09-07 con 4 sobreescrituras en 3 productos (2 borradores, 1 publicado): cada filtro selecciona lo esperado y reporta las omitidas |
| Copia de seguridad automática antes de `--aplicar` | Probado el 2026-09-07: el Excel descargado (537 filas) se reimporta con 0 cambios y 0 errores |
| `aplicar-overrides-woo.mjs --aplicar` | **No probado aún**: usa el mismo `bulkUpdate` del adaptador que sí está probado, pero la primera ejecución real es el paso B3 |
| Lógica de agotado en web, bot y checkout | Probada en local con stock simulado (60 comprobaciones) |
| Descuento de inventario al confirmarse un pago | **Pendiente**: paso B7 |
| Subida de medios a WordPress desde Vercel (`GET /api/admin/test-wp-medios`, temporal) | **Pendiente de que JD lo ejecute** (2026-09-07): autentica, sube, lee, asigna a un borrador, retira y borra. Hasta que no dé todo OK no se usa el panel de imágenes ni la migración |

## E. Imágenes (Fase A) — independiente del adaptador de inventario

La subida de imágenes desde el panel **no depende** de `NUXT_INVENTORY_BACKEND`:
funciona en mock o woo porque va directo a WordPress/Woo, y mientras
`NUXT_PUBLIC_IMAGES_SOURCE` siga en `local` (o sin definir) **la web no cambia**.
Tiene guarda propia: `NUXT_IMAGES_ONLY_DRAFTS=true` limita a borradores sin abrir
precios/stock (esos siguen bajo `NUXT_INVENTORY_WOO_ONLY_DRAFTS`). Default `false`.

- [ ] **[JD]** Ejecutar `https://www.disfraceskustom.com/api/admin/test-wp-medios`
      con la sesión del panel y pasar el JSON. Si todo es `ok: true`, se borra el
      endpoint y se puede usar el panel de imágenes.
- [ ] **[JD]** La migración de las 189 fotos (`scripts/migrar-imagenes-woo.mjs`)
      se corre **con JD presente**, primero en vista previa; nunca sin él.
