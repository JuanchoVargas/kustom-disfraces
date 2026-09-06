# Inventario — reporte de WooCommerce (lectura del 6 de septiembre de 2026)

Leído en vivo de api.disfraceskustom.com con la llave de solo lectura.

| Dato | Valor |
|---|---|
| Productos en Woo | 109 (66 publicados, 43 borradores) |
| Con SKU | 108 (uno sin SKU, ver abajo) |
| Tipo | 108 variables (una variación por talla) + 1 simple |
| Variaciones | 537 |
| SKU de variación | `{codigo}-T{talla}` (`001010001-T4`, `001010002-P-T0`, `001010001-TBebé`) |
| Precio | En la variación (`regular_price`); ningún producto con `sale_price` |
| Gestión de stock | Ajuste global activado; `manage_stock: false` en las 537 variaciones |
| Coincidencia con catalogo.json | 108 SKUs coinciden; 1 solo local y 1 solo en Woo |

## Los dos que no coinciden

| Dónde | Código | Nombre | Situación |
|---|---|---|---|
| Solo en catalogo.json | `001004007-P` | Kokushibo (anime, provisional, no visible en la web) | No existe en Woo. Decidir: crearlo en Woo o retirarlo del catálogo local. |
| Solo en Woo | *(sin SKU)* | HARLEY QUEEN (producto simple, borrador, sin precio) | Sin código no se puede enlazar. Decidir: asignarle código y tallas en Woo, o borrarlo. Hasta entonces el módulo lo ignora. |

## Otros hallazgos en productos PUBLICADOS

| Código | Producto | Hallazgo |
|---|---|---|
| `001001001` | Spider-Man Clásico | La variación **talla 2** no tiene `regular_price` en Woo (las demás tallas: $159.000). En la web se vende al precio del padre; conviene ponerle el precio en Woo (o desde el panel el día de la activación). |

Las 10 chaquetas (borradores) no tienen variaciones creadas en Woo (solo el
atributo Talla); el módulo las lista sin tallas hasta que se creen.

## Los 43 borradores (para que el cliente decida qué publicar)

Ninguno tiene foto en el catálogo local (columna "foto" = 0), así que aunque se
publiquen en Woo seguirían ocultos en la web hasta tener imágenes.

| Código | Nombre en Woo | Línea | Precio en Woo |
|---|---|---|---|
| 001001019 | BATMAN SUBL | Súper Acolchado | $129.900 |
| 001001020 | SUPERMAN BOR | Súper Acolchado | $129.900 |
| 001002013 | WOLVERINE DE LINEA | Línea Eco | $89.900 |
| 001003001 | SPIDERMAN CLASICO SEMI | Semi Acolchado | — |
| 001003002 | SPIDERMAN NEGRO SEMI | Semi Acolchado | — |
| 001003003 | IRON SPIDERMAN SEMI | Semi Acolchado | — |
| 001003004 | IRON-MAN SEMI | Semi Acolchado | — |
| 001003005 | BATMAN SEMI | Semi Acolchado | — |
| 001003006 | DEADPOOL SEMI | Semi Acolchado | — |
| 001003007 | SUPERMAN SEMI | Semi Acolchado | — |
| 001003008 | STAR WEAR BLANCO SEMI | Semi Acolchado | — |
| 001003009 | STAR WEAR NEGRO SEMI | Semi Acolchado | — |
| 001003010 | CAPITAN AMERICA SEMI | Semi Acolchado | — |
| 001003011 | VENOM NEGRO SEMI | Semi Acolchado | — |
| 001003012 | HULK SEMI | Semi Acolchado | — |
| 001003013 | THOR SEMI | Semi Acolchado | — |
| 001005008 | TRUSA WOLVERINE | Trusa adulto | $119.900 |
| 001005010 | Spider Gwen | Trusa adulto | — |
| 001007001 | THOR ADULTO | Súper Adulto | — |
| 001007002 | IRON SPIDERMAN | Súper Adulto | — |
| 001007003 | SPIDERMAN CLASICO | Súper Adulto | — |
| 001007004 | VENON NEGRO | Súper Adulto | — |
| 001007005 | SUPERMAN ADULTO SUB | Súper Adulto | — |
| 001007006 | DEADPOOL ADULTO | Súper Adulto | — |
| 001007007 | CAPITAN AMERICA | Súper Adulto | — |
| 001007008 | BATMAN CLASICO | Súper Adulto | — |
| 001007009 | SUPERMAN ADULTO BOR | Súper Adulto | — |
| 001008004 | VESTIDO NIÑA MERLINA | Vestidos | $119.900 |
| 001008005 | VESTIDO DAMA MARAVILLA | Vestidos | $119.900 |
| 001008006 | VESTIDO DAMA SUPERCHICA | Vestidos | $119.900 |
| 001008007 | VESTIDO DAMA MUJER ARAÑA | Vestidos | $119.900 |
| 001008008 | VESTIDO DAMA BATICHICA | Vestidos | $119.900 |
| 002001001 | CHAQUETA IRON SPIDERMAN | Chaquetas | — |
| 002001002 | CHAQUETA SPIDERMAN CLASICO | Chaquetas | — |
| 002001003 | CHAQUETA CAPITAN AMERICA | Chaquetas | — |
| 002001004 | CHAQUETA IRON MAN | Chaquetas | — |
| 002001005 | CHAQUETA MILES MORALES | Chaquetas | — |
| 002001006 | CHAQUETA FLASH | Chaquetas | — |
| 002001007 | CHAQUETA VENON NEGRO | Chaquetas | — |
| 002001008 | CHAQUETA DEADPOOL | Chaquetas | — |
| 002001009 | CHAQUETA SPIDERMAN NEGRO | Chaquetas | — |
| 002001010 | CHAQUETA HITACHI | Chaquetas | — |
| *(sin SKU)* | HARLEY QUEEN | ? (simple) | — |

Resumen por línea: 13 Semi Acolchado, 10 Chaquetas, 9 Súper Adulto, 5 Vestidos
(1 de niña), 2 Súper Acolchado, 2 Trusa adulto, 1 Línea Eco, 1 sin código.
Sin precio en Woo: Semi, Súper Adulto, Chaquetas y Spider Gwen (28 productos).
