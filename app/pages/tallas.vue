<script setup lang="ts">
useHead({
  title: 'Guía de tallas — Kustom Disfraces',
  meta: [{ name: 'description', content: 'Consulta la guía de tallas de Kustom Disfraces para elegir la talla correcta de tu disfraz.' }],
})

const zoom = ref(false)
</script>

<template>
  <ContentPage
    title="Guía de tallas"
    lead="Mide sobre una prenda que le quede bien y compara con la tabla. Si tienes dudas, escríbenos y te ayudamos a elegir."
  >
    <figure class="guia">
      <button type="button" class="guia__btn" aria-label="Ampliar la guía de tallas" @click="zoom = true">
        <img
          src="/images/guia-tallas.webp"
          alt="Guía de tallas de Kustom Disfraces"
          class="guia__img"
          width="1080"
          height="1350"
        >
      </button>
      <figcaption class="guia__cap">Toca la imagen para ampliarla.</figcaption>
    </figure>

    <SizeGuideModal v-model="zoom" />
  </ContentPage>
</template>

<style scoped>
.guia {
  margin: var(--space-4) 0 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.guia__btn {
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: #fff;
  cursor: zoom-in;
  overflow: hidden;
  max-width: 460px;
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
