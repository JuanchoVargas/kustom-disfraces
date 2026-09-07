# Imágenes desde Woo (Fase B) — qué medir ANTES de activar

Estado: construido en `feature/inventario-imagenes`, **desactivado**
(`NUXT_PUBLIC_IMAGES_SOURCE=local`). Estamos en temporada alta: no se cambia la
forma de servir imágenes sin estas tres mediciones en la mano.

## 1. ¿NuxtImg optimiza y CACHEA en el edge las imágenes de dominio externo?

Lo crítico: si cada visita golpea al hosting compartido de WordPress, no se activa.

Cómo comprobarlo en un **preview de Vercel** de la rama con
`NUXT_PUBLIC_IMAGES_SOURCE=woo` (variable de entorno solo en Preview):

1. Abrir una PDP y copiar la URL de la imagen principal que pinta `<NuxtImg>`.
   Debe empezar por `/_ipx/…/https://api.disfraceskustom.com/…` (pasa por IPX),
   NO por `https://api.disfraceskustom.com/…` (directa, sin optimizar).
2. Pedirla dos veces con `curl -sI <url>` y mirar las cabeceras:
   - `content-type: image/webp` (o avif) y un `content-length` menor que el
     original de WordPress (~38 KB → esperable ~15–25 KB a 400 px).
   - Primera vez `x-vercel-cache: MISS`; segunda vez **`HIT`**. Si siempre es
     `MISS`, el edge no la cachea y cada visita llega a IPX (que a su vez va a
     Hostinger): NO activar.
   - `cache-control` con `s-maxage` alto (IPX en Nuxt Image manda
     `max-age=31536000` por defecto; verificar que Vercel no lo recorte).
3. Repetir para 3 productos distintos y para una miniatura de la PLP.

Resultado esperado para activar: `_ipx` en la URL, `HIT` en la segunda petición
en los 3 casos, tamaño menor que el original.

## 2. Tiempo de carga de una ficha de producto: local vs Woo

Mismo preview, misma PDP (p. ej. `/producto/spider-man-clasico`), con
`NUXT_PUBLIC_IMAGES_SOURCE=local` y luego `woo`. Medir con Lighthouse (móvil,
3 corridas cada uno) o con `scripts/medir-inventario-ux.mjs` adaptado:

| Métrica | local | woo (edge frío) | woo (edge caliente) |
|---|---|---|---|
| LCP de la imagen principal | | | |
| Peso total de imágenes | | | |
| Tiempo hasta imagen principal visible | | | |

Aceptable: con el edge caliente, igual o mejor que local; en frío, no más de
~300 ms peor. Si el frío es habitual (poco tráfico por producto), pesa más.

## 3. ¿Qué pasa si el hosting de WordPress no responde?

Construido para degradar solo:
- **Catálogo**: el proxy ya cae a `catalogo.json` si Woo no responde → sin
  `imagenesWoo` → la web usa las locales. Sin cambio visible.
- **Imagen concreta**: si el edge no la tiene y Hostinger falla, IPX devuelve
  error; `<NuxtImg @error>` cambia esa imagen a la local de la misma posición
  (`imagesFallback`). El cliente ve la foto local sin recargar.
- **Prueba a hacer en el preview**: en `nuxt.config.ts` del preview apuntar
  `image.domains` a un dominio falso (o bloquear `api.disfraceskustom.com` en
  DevTools → Network → Block request domain) y navegar PLP y PDP: todas las fotos
  deben seguir viéndose (locales) y no debe haber imágenes rotas.

## Decisión

Solo con 1 = HIT, 2 = igual o mejor en caliente y 3 = sin imágenes rotas, se
propone poner `NUXT_PUBLIC_IMAGES_SOURCE=woo` en Production, y aun así fuera de
la temporada alta. El respaldo local se queda para siempre.
