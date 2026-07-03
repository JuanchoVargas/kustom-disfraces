<script setup lang="ts">
/**
 * SloganMarquee — cinta infinita del eslogan (un solo uso: Homepage).
 * Animación 100% CSS, 50s por vuelta, estática con prefers-reduced-motion.
 *
 * Estructura del loop: 2 copias idénticas del grupo (la 2ª aria-hidden) y
 * translateX(-50%). Para que el empalme sea invisible, TODAS las
 * separaciones (incluida la del final del grupo) son el mismo gap: el grupo
 * usa gap interno + padding-right idéntico, y el track no añade nada.
 *
 * Contenido: ciclo de 4 frases de marca (NUNCA promos/descuentos aquí).
 * El grupo duplicado contiene CICLOS COMPLETOS (3 ciclos = 12 unidades):
 * 12 es PAR (la alternancia outline/morado empalma entre copias) y
 * múltiplo de 3 (los íconos rotan sin repetirse en la costura).
 */
const PHRASES = [
  'Disfraces para cada historia',
  'Súper Acolchado',
  'Línea Eco',
  'Niños · Niñas · Adultos · Bebés',
]
const UNITS = 12 // 3 ciclos completos de las 4 frases

// mini-íconos line-art (mismos motivos del patrón espacial; stroke = currentColor)
const ICONS = [
  // cohete
  '<path d="M12 2.5c2.8 2 3.8 5.6 2.8 9.2l-2.8 2.8-2.8-2.8C8.2 8.1 9.2 4.5 12 2.5z"/><circle cx="12" cy="8.2" r="1.5"/><path d="M9.2 12.5 6.8 15M14.8 12.5l2.4 2.5M12 15v4.5"/>',
  // planeta con anillo
  '<circle cx="12" cy="12" r="4.4"/><ellipse cx="12" cy="12" rx="8.6" ry="2.8" transform="rotate(-18 12 12)"/>',
  // destello de 4 puntas
  '<path d="M12 3.5c.75 4.2 2.55 6 6.75 6.75-4.2.75-6 2.55-6.75 6.75-.75-4.2-2.55-6-6.75-6.75 4.2-.75 6-2.55 6.75-6.75z"/>',
]
const ICON_COLORS = ['var(--turq)', 'var(--yellow)', 'var(--fucsia)']
</script>

<template>
  <div class="marquee" aria-label="Disfraces para cada historia — Súper Acolchado, Línea Eco, para niños, niñas, adultos y bebés">
    <div class="marquee__band">
      <div class="marquee__track">
        <span
          v-for="copy in 2"
          :key="copy"
          class="marquee__group"
          :aria-hidden="copy === 2 ? 'true' : undefined"
        >
          <template v-for="i in UNITS" :key="i">
            <span class="mq__phrase" :class="i % 2 === 1 ? 'mq__phrase--outline' : 'mq__phrase--solid'">
              {{ PHRASES[(i - 1) % 4] }}
            </span>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <svg
              class="mq__icon"
              :style="{ color: ICON_COLORS[(i - 1) % 3] }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              v-html="ICONS[(i - 1) % 3]"
            />
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Contenedor: da el aire vertical que necesita la banda inclinada para no
   cortar hero/TrustBar; el fondo texturizado de la página asoma en las
   esquinas (no hay cuñas blancas: la banda sobresale del viewport). */
.marquee {
  padding: 30px 0;
  overflow: hidden;
}
.marquee__band {
  background: var(--hueso); /* crema sólido, sin patrón */
  overflow: hidden;
  padding: 18px 0;
  white-space: nowrap;
  /* banda inclinada, más ancha que el viewport para cubrir los extremos */
  width: 106%;
  margin-left: -3%;
  transform: rotate(-2deg);
}
.marquee__track {
  display: flex;
  width: max-content;
  animation: marquee-slide 50s linear infinite;
}
.marquee__group {
  display: flex;
  align-items: center;
  gap: 28px;
  padding-right: 28px; /* = gap: el empalme entre copias queda idéntico */
  flex-shrink: 0;
}
.mq__phrase {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: 34px;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.mq__phrase--outline {
  color: transparent;
  -webkit-text-stroke: 1.5px var(--ink);
}
/* sin soporte de text-stroke: relleno sólido antes que invisible */
@supports not (-webkit-text-stroke: 1px black) {
  .mq__phrase--outline { color: var(--ink); }
}
.mq__phrase--solid {
  color: var(--purple);
}
.mq__icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

@keyframes marquee-slide {
  to { transform: translateX(-50%); }
}

@media (max-width: 720px) {
  .marquee { padding: 18px 0; }
  .marquee__band { padding: 13px 0; }
  .marquee__group { gap: 20px; padding-right: 20px; }
  .mq__phrase { font-size: 26px; }
  .mq__icon { width: 20px; height: 20px; }
}

/* movimiento reducido: la cinta queda estática y visible */
@media (prefers-reduced-motion: reduce) {
  .marquee__track { animation: none; }
}
</style>
