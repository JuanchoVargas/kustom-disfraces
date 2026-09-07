# Panel de inventario — medición de rendimiento (antes / después)

Medido el 2026-09-06 con `scripts/medir-inventario-ux.mjs` (Edge en ventana real,
1380×900, dev server local, datos reales de Woo: 108 productos, 537 tallas).
Escenario de estrés: **100 productos por página, todos expandidos**, scroll
continuo de 3 s a 45 px por frame. La medición en ventana real importa: con la
pestaña en segundo plano el navegador congela los frames y las cifras mienten.

| Métrica | Antes (tabla completa) | Después (virtualizada) |
|---|---|---|
| Tiempo hasta interactivo (domInteractive, mediana de 3 cargas) | 101 ms | 105 ms |
| Primeras filas pintadas (marca `inventario:filas`) | — (sin marca; en la sesión previa ~1.430 ms) | 1223 ms |
| Expandir los 100 productos | 383 ms | 79 ms |
| Nodos en el DOM con todo expandido | 11.013 | 686 |
| Bloques de tallas montados | 100 | 4 (solo los visibles) |
| Scroll: fps promedio | 24 | 84 |
| Scroll: frame p50 | 41.6 ms | 8.4 ms |
| Scroll: frame p95 | 125.1 ms | 33.3 ms |
| Scroll: frame máximo | 142 ms | 58 ms |
| Scroll: frames > 50 ms (tirones) en 3 s | 23 de 72 | 1 de 253 |
| Píxeles recorridos en 3 s | 3.240 | 11.385 |
| Tecleo en el buscador → lista filtrada | 5007 ms (no terminó de refrescar en 5 s) | 45 ms |

Lectura: la tabla anterior montaba las 537 tallas expandidas de golpe (11.013
nodos) y el scroll caía a 24 fps con 23 tirones en 3 s. La virtualizada mantiene
~700 nodos, 84 fps y un solo frame por encima de 50 ms. Ambos "tiempo hasta
interactivo" son ~100 ms porque el HTML del panel es mínimo; lo que cambia es el
tiempo a las primeras filas y, sobre todo, la fluidez con todo abierto.

Qué cambió (rama `feature/inventario-ux`):
- Lista virtualizada con `@tanstack/vue-virtual` (headless, ~5 KB): una lista
  plana de filas de producto + bloques de tallas abiertos; solo se montan los
  visibles (+6 de overscan). Alturas dinámicas con `measureElement`.
- Transiciones CSS puras: expandir/contraer con `grid-template-rows 0fr→1fr`,
  destello verde al confirmar el guardado, fade + translate de 150–180 ms al
  filtrar. Todo desactivado con `prefers-reduced-motion`.
- Actualización optimista: la fila cambia al instante; si el servidor rechaza,
  se revierte y el mensaje queda en la fila. Indicador "guardando" por celda.
- Skeletons en la primera carga; debounce de 300 ms en el buscador; historial
  y cabecera del producto se refrescan en segundo plano tras guardar.
