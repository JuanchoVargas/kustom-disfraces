<script setup lang="ts">
useHead({
  title: 'Guía de tallas — Kustom Disfraces',
  meta: [{ name: 'description', content: 'Consulta la guía de tallas de Kustom Disfraces para elegir la talla correcta de tu disfraz.' }],
})

// La Línea Eco tiene su propia tabla de medidas; el resto usa la guía general.
const GUIAS = [
  { variant: 'general', titulo: 'Guía general', src: '/images/guia-tallas.webp', alt: 'Guía de tallas de Kustom Disfraces', width: 1080, height: 1350 },
  { variant: 'eco', titulo: 'Línea Eco', src: '/images/guia-tallas-eco.webp', alt: 'Guía de tallas de la Línea Eco de Kustom Disfraces', width: 1132, height: 1600 },
] as const

const zoom = ref(false)
const zoomVariant = ref<'general' | 'eco'>('general')
function openZoom(variant: 'general' | 'eco') {
  zoomVariant.value = variant
  zoom.value = true
}
</script>

<template>
  <ContentPage
    title="Guía de tallas"
    lead="Mide sobre una prenda que le quede bien y compara con la tabla. Los disfraces de la Línea Eco tienen su propia tabla de medidas. Si tienes dudas, escríbenos y te ayudamos a elegir."
  >
    <div class="guias">
      <figure v-for="g in GUIAS" :key="g.variant" class="guia">
        <figcaption class="guia__title">{{ g.titulo }}</figcaption>
        <button type="button" class="guia__btn" :aria-label="`Ampliar la guía de tallas (${g.titulo})`" @click="openZoom(g.variant)">
          <img
            :src="g.src"
            :alt="g.alt"
            class="guia__img"
            :width="g.width"
            :height="g.height"
            loading="lazy"
          >
        </button>
        <p class="guia__cap">Toca la imagen para ampliarla.</p>
      </figure>
    </div>

    <SizeGuideModal v-model="zoom" :variant="zoomVariant" />
  </ContentPage>
</template>

<style scoped>
.guias {
  margin-top: var(--space-4);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-6);
}
.guia {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1 1 320px;
  max-width: 460px;
}
.guia__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-lg);
  color: var(--ink);
  margin-bottom: var(--space-3);
}
.guia__btn {
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: #fff;
  cursor: zoom-in;
  overflow: hidden;
  width: 100%;
  box-shadow: var(--shadow);
}
.guia__btn:focus-visible { outline: 3px solid var(--turq); outline-offset: 3px; }
.guia__img {
  display: block;
  width: 100%;
  height: auto;
}
.guia__cap {
  margin-top: var(--space-3);
  color: var(--mut);
  font-size: 13px;
}
</style>
