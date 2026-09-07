# Respuestas del bot de Kustom Disfraces

**Documento de revisión para el cliente.** Aquí están **todas** las respuestas que el bot puede dar por WhatsApp, Messenger e Instagram, con el texto exacto, qué las dispara y qué botones muestran. Sirve para revisar, corregir y aprobar los textos antes de que se apliquen.

Fecha del inventario: 2026-09-05 · Actualizado 2026-09-06 (rama `feature/bot-conversion`: ficha con botones de venta, "¿Qué talla?", sin-resultados con parecidos, descuento, personalización, leads con teléfono)

---

## Cómo usar este documento

1. Lea cada respuesta (columna **Texto actual**).
2. Si quiere cambiar algo, escriba el nuevo texto en la fila **Texto propuesto** o comente al lado.
3. Los cambios de texto son sencillos de aplicar. Los cambios de **lógica** (qué palabras disparan qué, orden de botones, nuevas preguntas) también se pueden hacer, pero se coordinan aparte.

### Convenciones

| Símbolo | Significado |
|---|---|
| `*texto*` | Aparece en **negrita** en WhatsApp y Messenger. |
| `{nombre}` | Nombre del perfil del cliente (si Meta lo entrega). Si no viene, el saludo es "¡Hola! 👋". |
| `{sitio}` | Dirección de la web: `https://www.disfraceskustom.com`. |
| `{...}` | Cualquier otro dato que el bot completa solo desde el catálogo (precios, tallas, cantidades). |
| 🔘 | Botón (respuesta de un toque). |
| 📋 | Lista desplegable (WhatsApp) o burbujas de respuesta rápida (Messenger / Instagram). |

### Cómo se ven los menús en cada canal

- **WhatsApp:** los menús de hasta 3 opciones van como botones. Los de más opciones se parten en tandas de 3 botones; la primera tanda lleva el texto del mensaje y las siguientes dicen solo **"Más opciones 👇"**. Si WhatsApp rechaza el mensaje interactivo, el bot lo reenvía como texto numerado (ver sección 11).
- **Messenger / Instagram:** todas las opciones van como burbujas de respuesta rápida debajo del mensaje, y el texto termina con **"Toca una opción 👇"**.
- En todos los menús (salvo el principal) aparecen al final **"⬅️ Volver"** y **"🏠 Menú"**.

---

## 1. Bienvenida y menú principal

**Cuándo aparece**
- Primer mensaje de un cliente nuevo.
- Cuando el cliente escribe un saludo: *hola, holaa, ola, holi, buenas, buenos días, buenas tardes, buenas noches, hey, hi, hello, saludos, qué tal*.
- Cuando escribe *menú, inicio, empezar, start*.
- Al tocar 🔘 **🏠 Menú** en cualquier pantalla.
- Cuando el bot no entiende el mensaje y no hay nada más que hacer.

**Texto actual (WhatsApp, lista 📋 con botón "Ver opciones", sección "Menú")**

```
¡Hola, {nombre}! 👋 Soy el asistente de *Kustom Disfraces* 👽
¿Qué quieres hacer?
💡 O escríbeme lo que buscas y te lo encuentro. Ej: *spiderman talla 6*
```

Opciones:
1. Ver disfraces
2. Cómo comprar
3. Hablar con alguien
4. Ver catálogo 📖

**Texto propuesto:** _______________________________________________

> Nota: el saludo y el menú **borran la memoria** de lo que el cliente venía buscando (personaje, talla).

---

## 2. Ver disfraces → ¿Para quién es?

**Cuándo aparece:** al tocar 🔘 **Ver disfraces** o al volver desde una lista de categorías.

**Texto actual (lista 📋, botón "Ver públicos", sección "Públicos")**

```
¿Para quién es el disfraz? 🎭
💡 Si ya sabes cuál quieres, solo escríbelo.
```

Opciones (se calculan solas desde el catálogo; la cantidad cambia con el inventario):

| Opción | Descripción hoy |
|---|---|
| Bebés | 7 disfraces |
| Niños | 40 disfraces |
| Niñas | 11 disfraces |
| Damas | 9 disfraces |
| Caballeros | Muy pronto |
| ⬅️ Volver | |
| 🏠 Menú | |

> "Combos" no se muestra porque no tiene productos ni subcategorías activas. Un público sin productos pero con categorías previstas (Caballeros) aparece con la leyenda **"Muy pronto"**.

**Texto propuesto:** _______________________________________________

---

## 3. Público elegido → categorías

**Cuándo aparece:** al tocar un público (Bebés, Niños…) o cuando el cliente escribe solo un público (ver sección 9).

### 3a. Público con productos

**Texto actual (lista 📋, botón "Ver categorías", sección con el nombre del público)**

```
Categorías de *{Público}* 🎃
```

Opciones hoy (se calculan solas; solo se listan categorías con productos):

| Público | Categorías que se muestran |
|---|---|
| Bebés | Peluches Plus (2), Peluches de Línea (5) |
| Niños | Súper Acolchados (18), Línea Eco (13), Anime (4), Trusas (1), Ninjas (3) |
| Niñas | Vestidos (4), Trusas (5), Anime (2) |
| Damas | Trusas (9) |

Cada fila lleva la descripción "**N disfraces**". Al final: ⬅️ Volver · 🏠 Menú.

**Texto propuesto:** _______________________________________________

### 3b. Público sin productos todavía (hoy: Caballeros)

**Texto actual (botones 🔘)**

```
Estamos cargando más de *Caballeros* 👀
Míralo en la web 👇
{sitio}/categoria/caballeros
```

Botones: **Ver otros** · **Hablar con alguien** · ⬅️ Volver · 🏠 Menú (se parte en dos tandas en WhatsApp).

**Texto propuesto:** _______________________________________________

---

## 4. Categoría elegida → enlace a la web

**Cuándo aparece:** al tocar una categoría (por ejemplo Súper Acolchados de Niños).

**Texto actual (botones 🔘)**

```
¡Genial! Mira los disfraces de *{Categoría}* para *{Público}* 👇
{sitio}/categoria/{publico}?sub={categoria}
💡 ¿Buscas algo específico? Escríbeme el nombre y te lo busco.
```

Botones: **🛒 Comprar en la web** · **💬 Pedir por WhatsApp** · ⬅️ Volver · 🏠 Menú.

**Texto propuesto:** _______________________________________________

### 4a. Al tocar "🛒 Comprar en la web"

**Texto actual (texto plano)**

```
Aquí tienes el link para comprar en la web 🛒
{sitio}/categoria/{publico}?sub={categoria}

Escribe *menú* para volver al inicio.
```

> En Messenger / Instagram la última línea se quita y en su lugar va la burbuja 🏠 Menú.

**Texto propuesto:** _______________________________________________

### 4b. Al tocar "💬 Pedir por WhatsApp"

Pasa la conversación a una persona del equipo. Es la **misma respuesta** de la sección 7.

---

## 5. Cómo comprar

**Cuándo aparece:** al tocar 🔘 **Cómo comprar** en el menú principal.

**Texto actual (botones 🔘)**

```
🛍️ *Cómo comprar en Kustom:*
1️⃣ Elige tu disfraz en la web
2️⃣ Págalo con Mercado Pago o pídelo por WhatsApp
3️⃣ Coordinamos el envío 🚚

Guía completa: {sitio}/como-comprar
```

Botones: **Ver disfraces** · **Hablar con alguien** · ⬅️ Volver · 🏠 Menú.

**Texto propuesto:** _______________________________________________

---

## 6. Ver catálogo (PDF)

**Cuándo aparece:** al tocar 🔘 **Ver catálogo 📖** en el menú principal, o 🔘 **Ver catálogo** cuando una búsqueda no encuentra nada.

**Texto actual (texto plano)**

```
Aquí tienes nuestro catálogo completo 👇
{sitio}/catalogo-kustom.pdf
Cuando veas uno que te guste, escríbeme el nombre y te paso precio y tallas 😉
```

**Texto propuesto:** _______________________________________________

---

## 7. Hablar con alguien (paso a una persona)

**Cuándo aparece**
- Al tocar 🔘 **Hablar con alguien** (menú principal, cómo comprar, sin resultados, público vacío) o 🔘 **💬 Pedir por WhatsApp**.
- Cuando el cliente **escribe** que quiere una persona. Frases que lo activan:
  - El mensaje es solo el pedido: *asesor, asesora, un asesor por favor, agente, humano, vendedor, operador…*
  - Verbo + con quién: *quiero hablar con alguien, hablar con una persona, chatear con un asesor, comunicarme con ustedes, contactar al equipo, hablar con el encargado…*
  - *necesito / quiero / busco / pásame / póngame un asesor / agente / humano / vendedor* (no aplica si la frase habla de un disfraz: "busco disfraz de agente secreto" **no** pasa a humano).
  - *que me atienda alguien, que me atienda una persona, atención humana, alguien que me ayude, una persona real / de verdad*.

**Texto actual (texto plano)**

```
Te paso con una persona del equipo 🙌
En un momento te escribimos por aquí. Horario: Lunes a sábado, 8:00 a.m. a 7:00 p.m.

(Escribe *menú* si quieres volver a las opciones.)
```

**Texto propuesto:** _______________________________________________

**Qué pasa después**
- El bot **se queda callado**: no responde nada más hasta que el cliente escriba un saludo o *menú* (o toque 🏠 Menú), o hasta que un agente devuelva la conversación al bot desde la bandeja.
- Si un agente toma la conversación o responde desde la bandeja, el bot queda apagado hasta que lo devuelvan.
- Si en **30 minutos** nadie del equipo responde, la conversación vuelve sola al bot (el cliente no recibe ningún aviso de esto; simplemente el bot vuelve a contestar su siguiente mensaje).
- El equipo recibe una alerta (ver sección 12).

---

## 8. Búsqueda de disfraces por texto libre

El cliente puede escribir el nombre de un personaje en cualquier momento: *spiderman, hombre araña talla 6, goku para niño, cuánto vale el batman…*

El bot:
- Tolera errores de escritura pequeños (*spaiderman → spiderman, hombra araña → hombre araña*).
- Entiende la talla escrita como *talla 6*, *t 6*, *talla: 6* (de 0 a 14).
- Entiende palabras de público (*niño, niña, bebé, dama, caballero, hombre, mujer*).
- Ignora palabras de precio (*precio, cuánto vale, cuesta…*) y palabras genéricas (*disfraz, traje, algo, tipo…*).
- Recuerda durante **30 minutos** el último personaje, talla y público que el cliente mencionó, para combinar mensajes cortos ("Superman" y luego "talla 10").

### 8a. Una sola coincidencia → ficha del producto

**Texto actual (texto plano)**

```
🎭 *{Nombre del producto}*
💲 {precio}
📏 Tallas: {tallas}
🔗 {sitio}/producto/{slug}

Escribe *MENÚ* para volver.
```

Si el cliente pidió una talla, entre las tallas y el enlace se agrega **una** de estas líneas:

```
✅ Talla *{N}* disponible
```
```
⚠️ Talla *{N}* no disponible en este. Tallas: {tallas}
```

Ejemplo real:

```
🎭 *Spider-Man Clásico*
💲 $159.000
📏 Tallas: 0, 2, 4, 6, 8, 10, 12
✅ Talla *6* disponible
🔗 https://www.disfraceskustom.com/producto/spider-man-clasico

Escribe *MENÚ* para volver.
```

**Texto propuesto:** _______________________________________________

### 8b. Varias coincidencias → lista agrupada por línea

**Texto actual (lista 📋 con botón "Ver opciones", máximo 8 productos)**

```
Encontré {N} opciones 👇
```
o, si pidió talla:
```
Encontré {N} opciones (talla {T}) 👇
```

Los productos se agrupan por línea con estos encabezados (editables):

| Grupo del catálogo | Encabezado que ve el cliente |
|---|---|
| Súper acolchado (niños y adultos) | 🦸 Súper Acolchado |
| Semi acolchado | 🦸 Semi Acolchado |
| Económico | 🌱 Línea Eco |
| Anime | 🎌 Anime |
| Ninjas | 🥷 Ninjas |
| Trusas (adulto e infantil) | 🩱 Trusas |
| Vestidos | 👗 Vestidos |
| Peluches (plus y línea) | 🧸 Peluches |
| Personajes | 🎭 Personajes |
| Chaquetas | 🧥 Chaquetas |
| Cualquier otro | 🎭 Otros |

Cada producto se muestra como fila: **{Nombre}** con descripción "**{precio} · tallas {tallas}**". Al final, sección "Navegación": ⬅️ Volver · 🏠 Menú.

Ejemplo (Messenger / texto numerado):

```
Encontré 2 opciones (talla 6) 👇

🦸 *Súper Acolchado*
1. Spider-Man Clásico — $159.000 · tallas 0, 2, 4, 6, 8, 10, 12

🌱 *Línea Eco*
2. Spider-Man Clásico Línea Eco — $69.000 · tallas 2, 4, 6, 8, 10, 12

Toca una opción 👇
```

Al tocar un producto de la lista se muestra su ficha (8a) con el ✅/⚠️ de la talla pedida.

**Texto propuesto:** _______________________________________________

### 8c. Ninguna coincidencia

**Texto actual (botones 🔘)**

```
No encontré ese disfraz en nuestro catálogo. Puedes ver el catálogo completo aquí 👇
{sitio}/catalogo-kustom.pdf
O si prefieres, te paso con una persona del equipo 🙌
```

Botones: **Ver catálogo** · **Hablar con alguien** · **🏠 Menú**.

**Texto propuesto:** _______________________________________________

> Existe una versión de reserva de este mensaje (solo en casos raros, cuando la búsqueda interna falla en un segundo paso): "No encontré nada para *"{lo que escribió}"* 😅 / Puedo mostrarte el catálogo por categorías o pasarte con una persona." seguido del menú principal. Si se aprueba el texto de arriba, se unifican los dos.

---

## 9. Cliente escribe solo el público o solo la talla

### 9a. Solo público ("para niña", "es para un bebé", "hombre")

Se muestra la lista de categorías de ese público (sección 3) pero con este encabezado:

```
¿Qué personaje buscas para *{Público}*? 😊
```

**Texto propuesto:** _______________________________________________

### 9b. Solo talla, sin personaje ("talla 8")

**Texto actual (botones 🔘)**

```
¡Anoté tu talla *{N}*! 👌 ¿Qué personaje o disfraz buscas? 😊
```

Botones: **Ver categorías** · **🏠 Menú**.

**Texto propuesto:** _______________________________________________

> Si el cliente ya había nombrado un personaje en los últimos 30 minutos, "talla 8" muestra directamente la ficha de ese producto con el ✅/⚠️ de la talla.

### 9c. Pregunta suelta con un producto reciente ("¿y cuánto vale?")

Vuelve a mostrar la ficha (8a) del último producto mencionado.

---

## 10. Preguntas informativas

El bot detecta estas preguntas por palabras clave y responde con un texto fijo **más el menú principal** debajo, con el encabezado:

```
¿Qué más quieres hacer? 👇
```

Si en la misma frase hay un personaje que sí existe ("precio del spiderman"), gana la ficha del producto.

### 10a. Tallas

**Palabras que la activan:** talla(s), talle(s), medida(s), tamaño(s), mide, miden, centímetros, cm, estatura. (Escribir "talla 8" con número **no** es esta pregunta; es una búsqueda.)

```
Manejamos tallas de la 0 a la 14 según el disfraz 📏
Mira la guía completa aquí 👇
{sitio}/tallas

Si me dices el personaje y la talla, te confirmo si la tenemos 😉
```

**Texto propuesto:** _______________________________________________

### 10b. Envíos

**Palabras:** envío(s), envían, envía, enviar, domicilio(s), entrega(s), entregan, transportadora, llega, llegan, llegaría, demora, demoran, tarda(n), Servientrega, Interrapidísimo, Coordinadora.

```
🚚 ¡El envío es *GRATIS* a todo el país!
Enviamos a Bogotá y a toda Colombia con guía de la transportadora para que hagas seguimiento. El tiempo de entrega depende del destino.
Más info: {sitio}/envios
```

**Texto propuesto:** _______________________________________________

### 10c. Formas de pago

**Palabras:** pago(s), pagar, pagan, pagas, pagamos, pagando, Nequi, Daviplata, transferencia, consignación, efectivo, tarjeta, contra entrega, Mercado Pago, PSE, Bancolombia, datáfono, cuotas, métodos / formas de pago.

```
💳 Puedes pagar por *Nequi*, *transferencia o consignación bancaria*, con *Mercado Pago* en la web, o *contra entrega* (pagas al recibir) 🏠
Aquí te explicamos paso a paso: {sitio}/como-comprar
```

**Texto propuesto:** _______________________________________________

### 10d. Cambios y garantías

**Palabras:** garantía(s), cambio(s), cambiar, devolución(es), devolver, reembolso, defecto(s), defectuoso/a.

```
🔁 *Cambios y garantías*
La garantía cubre defectos de fabricación (costuras, roturas o manchas) si nos devuelves el disfraz en máximo 3 días, con su empaque y comprobante de compra.
Los cambios se hacen en nuestros puntos de venta o escribiendo a contacto@disfraceskustom.com.
Todos los detalles: {sitio}/devoluciones
```

**Texto propuesto:** _______________________________________________

### 10e. Mayoristas

**Palabras:** mayorista(s), al por mayor, por mayor, al mayor, distribuidor(es/a/as), revender, reventa, docena(s).

```
🏷️ ¡Sí manejamos ventas al por mayor!
Déjanos tus datos aquí y te contactamos con precios especiales 👇
{sitio}/mayoristas
```

**Texto propuesto:** _______________________________________________

### 10f. Horario

**Palabras:** horario(s), hora de atención, abren, cierran, atienden, abierto(s), hasta qué hora, a qué hora, qué días.

```
🕒 Nuestro horario de atención es de *lunes a sábado, de 8:00 a.m. a 7:00 p.m.*
Por aquí puedes escribirnos a cualquier hora y te respondemos en ese horario.
```

**Texto propuesto:** _______________________________________________

### 10g. Dirección

**Palabras:** dirección, ubicados, ubicación, dónde están / quedan / queda / se encuentran, local, tienda física, punto de venta, sede, almacén, visitarlos, ir personalmente.

```
📍 Estamos en *Cra 52 #39-89 sur, Bogotá*.
Horario: lunes a sábado, de 8:00 a.m. a 7:00 p.m. 🕒
Y si prefieres, enviamos *gratis* a todo el país 🚚
```

**Texto propuesto:** _______________________________________________

### 10h. Precio en general (sin personaje)

**Palabras:** precio(s), vale, valen, cuesta, cuestan, costo(s), cuánto(s). Si nombra un personaje que **no** existe ("precio de diosa griega"), responde "sin resultados" (8c).

```
💲 Nuestros disfraces van desde {precio mínimo} hasta {precio máximo} según la línea y la talla.
Escríbeme el personaje que buscas y te paso el precio exacto 😉
Catálogo completo: {sitio}/catalogo-kustom.pdf
```

Hoy los precios se calculan solos desde el catálogo: **$69.000** a **$159.000**.

**Texto propuesto:** _______________________________________________

> El **orden** en que se revisan las palabras importa cuando una frase tiene varias: mayoristas → garantía → pago → tallas → envío → horario → dirección → precio. Por eso "contra entrega" responde pago y no envío.

---

## 11. Mensajes que no son texto y casos especiales

### 11a. Audio, foto, sticker, video, documento, ubicación o contacto

El bot no puede leerlos (quedan guardados en la bandeja para que el equipo los vea). Responde con el menú principal, pero con este encabezado en lugar del saludo:

```
Por ahora solo puedo leer mensajes de texto 😅 Escríbeme el nombre del disfraz que buscas o toca una opción 👇
```

**Texto propuesto:** _______________________________________________

### 11b. Reacciones (👍 ❤️ a un mensaje)

El bot **no responde nada**.

### 11c. Menú como texto numerado (solo WhatsApp, cuando falla el mensaje con botones)

Formato:

```
{texto del mensaje}

1. {Opción 1}
2. {Opción 2} — {descripción}
...

0. ⬅️ Volver

Responde con el número de la opción.
```

El cliente responde con el número y el bot lo entiende. "0", "volver", "atrás" o "regresar" retroceden un nivel.

**Texto propuesto:** _______________________________________________

### 11d. Textos de navegación (comunes a todo)

| Texto | Dónde |
|---|---|
| ⬅️ Volver | Botón/fila en todos los menús salvo el principal. |
| 🏠 Menú | Botón/fila en todos los menús salvo el principal; burbuja en fichas y textos (Messenger). |
| Más opciones 👇 | Segunda y siguientes tandas de botones en WhatsApp. |
| Toca una opción 👇 | Cierre de todo menú en Messenger / Instagram. |
| Ver opciones / Ver públicos / Ver categorías | Etiqueta del botón que abre la lista en WhatsApp. |
| Menú / Públicos / {Público} / Opciones / Navegación | Títulos de las secciones dentro de las listas de WhatsApp. |

**Texto propuesto:** _______________________________________________

---

## 12. Avisos internos al equipo (no los ve el cliente)

Cuando un cliente pide hablar con alguien (sección 7):

- **Correo** a ventas@ con asunto `🙋 {canal}: {nombre o número} pide atención` y el último mensaje del cliente. Incluye la nota: "En WhatsApp solo se puede responder con texto libre dentro de las 24 horas siguientes al último mensaje del cliente."
- **WhatsApp** al celular del encargado con la plantilla aprobada en Meta `alerta_atencion` (parámetros: nombre, número o usuario, último mensaje). El texto de esa plantilla se edita en Meta, no en el código.
- Hay un tiempo mínimo entre alertas de la misma conversación para no repetir avisos.

---

## 13. Resumen: todas las salidas de un vistazo

| # | Respuesta | Se dispara con | Tipo |
|---|---|---|---|
| 1 | Bienvenida + menú principal | saludo, menú, primer mensaje, 🏠 Menú, mensaje no entendido | Lista 4 opciones |
| 2 | ¿Para quién es el disfraz? | Ver disfraces | Lista de públicos |
| 3a | Categorías de {Público} | público con productos | Lista de categorías |
| 3b | Estamos cargando más de {Público} | público sin productos | Botones |
| 4 | ¡Genial! Mira los disfraces de… | categoría elegida | Botones + enlace |
| 4a | Aquí tienes el link para comprar… | 🛒 Comprar en la web | Texto |
| 5 | Cómo comprar en Kustom | Cómo comprar | Botones |
| 6 | Catálogo PDF | Ver catálogo | Texto |
| 7 | Te paso con una persona del equipo | Hablar con alguien, Pedir por WhatsApp, texto pidiendo persona | Texto + silencio del bot |
| 8a | Ficha de producto | búsqueda con 1 resultado, toque en lista, talla con producto reciente | Texto |
| 8b | Encontré N opciones | búsqueda con 2 o más resultados | Lista agrupada |
| 8c | No encontré ese disfraz | búsqueda sin resultados | Botones |
| 9a | ¿Qué personaje buscas para {Público}? | solo público escrito | Lista de categorías |
| 9b | ¡Anoté tu talla N! | solo talla escrita | Botones |
| 10a–h | Tallas, envíos, pago, garantías, mayoristas, horario, dirección, precio | palabras clave | Texto + menú |
| 11a | Por ahora solo puedo leer mensajes de texto | audio, foto, sticker, video, documento, ubicación, contacto | Menú con aviso |
| 11b | (silencio) | reacción con emoji | — |
| 11c | Menú numerado | falla del mensaje interactivo en WhatsApp | Texto |
| — | (silencio) | conversación en manos de un agente o esperando agente | — |

---

## Anexo técnico (para el equipo de desarrollo)

Dónde vive cada texto, para aplicar los cambios aprobados:

| Respuesta | Archivo y función |
|---|---|
| 1 Menú principal | `server/utils/whatsappBot.ts` → `mainMenu()` |
| 2 Públicos | `whatsappBot.ts` → `publicosList()`; nombres en `app/data/navegacion.json` |
| 3a/3b Categorías | `whatsappBot.ts` → `subcategoriasList()` |
| 4 / 4a Enlace categoría, comprar | `whatsappBot.ts` → `subLink()`, `buyResend()` |
| 5 Cómo comprar | `whatsappBot.ts` → `comoComprar()` |
| 6 Catálogo | `whatsappBot.ts` → `catalogoLink()` |
| 7 Handoff | `whatsappBot.ts` → `handoff()`; detección por texto en `server/utils/botReplies.ts` → `isHumanRequest()` |
| 8a Ficha | `whatsappBot.ts` → `productoFicha()` |
| 8b Lista de resultados y nombres de líneas | `whatsappBot.ts` → `resultadosList()`, `LINEA_INFO` |
| 8c Sin resultados | `botReplies.ts` → `sinResultados()` (reserva: `whatsappBot.ts` → `sinResultados()`) |
| 9a / 9b Público y talla sueltos | `botReplies.ts` → `promptPersonaje()`, `askPersonaje()` |
| 10 Preguntas informativas y sus palabras clave | `botReplies.ts` → `INFO_TEXT`, `INFO_RULES`, `infoReply()` |
| 11a Aviso no-texto | `botReplies.ts` → `NON_TEXT_NOTICE` |
| 11c Menú numerado | `server/utils/whatsapp.ts` → `waNumberedFallback()` |
| 11d "Más opciones", "Toca una opción" | `whatsapp.ts` → `toButtonChunks()`; `server/utils/messenger.ts` → `toMessengerMessages()` |
| Tips 💡 | `botReplies.ts` → `TIP_MENU`, `TIP_PUBLICOS`, `TIP_SUBLINK` |
| Saludos, reinicio, volver, público, precio | `botReplies.ts` → `isGreetTok()`, `RESET_WORDS`, `BACK_WORDS`, `PUBLICO_WORDS`, `PRICE_WORDS` |
| 12 Alertas internas | `server/utils/botSession.ts` → `notifyManagerWhatsApp()`; `server/utils/orderEmail.ts` → `sendHandoffAlert()` |

Límites a respetar al editar: botones máximo 3 por mensaje y 20 caracteres de título; filas de lista máximo 10, título 24 caracteres y descripción 72; cuerpo del mensaje interactivo máximo 1024 caracteres; texto plano máximo 4096 (WhatsApp) y 2000 (Messenger).
