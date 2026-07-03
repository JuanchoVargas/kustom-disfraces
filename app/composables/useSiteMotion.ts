/**
 * Presets de movimiento Kustom — sutil, premium, editorial (NO juguetón).
 * Respeta prefers-reduced-motion: si el usuario pidió movimiento reducido,
 * los presets se vuelven no-op (el elemento queda visible, sin animación).
 *
 * Easing = nuestro token --ease-out (cubic-bezier(.22,.61,.36,1)): salida
 * suave, sin rebotes.
 */
const EASE = [0.22, 0.61, 0.36, 1]

export const useSiteMotion = () => {
  const reduced = usePreferredReducedMotion()
  const animate = computed(() => reduced.value !== 'reduce')

  // Scroll reveal (una sola vez al entrar en viewport): fade + slide-up.
  // Recorrido y duración calibrados para que SE NOTE sin volverse juguetón.
  const reveal = (delay = 0) =>
    animate.value
      ? {
          initial: { opacity: 0, y: 32 },
          visibleOnce: { opacity: 1, y: 0, transition: { duration: 700, delay, ease: EASE } },
        }
      : {}

  // Entrada al cargar (fade-up): para hero (título, subtítulo, CTA).
  const enterUp = (delay = 0) =>
    animate.value
      ? {
          initial: { opacity: 0, y: 26 },
          enter: { opacity: 1, y: 0, transition: { duration: 700, delay, ease: EASE } },
        }
      : {}

  // Entrada de formas orgánicas: escala + fade lentos y suaves.
  const enterBlob = (delay = 0) =>
    animate.value
      ? {
          initial: { opacity: 0, scale: 0.7 },
          enter: { opacity: 1, scale: 1, transition: { duration: 1100, delay, ease: EASE } },
        }
      : {}

  return { animate, reveal, enterUp, enterBlob }
}
