<script setup lang="ts">
/**
 * Cabecera temática de categoría (por ahora solo Niños). Wordmark + composición
 * de personajes transparente, DIRECTO sobre el crema texturizado de la PLP
 * (sin caja blanca ni mix-blend). Altura contenida para no robar grilla.
 */
interface Props {
  wordmark: string
  wordmarkAlt: string
  image: string
  imageAlt: string
  count?: number
  countLabel?: string
}
defineProps<Props>()
</script>

<template>
  <section class="cathero" aria-hidden="false">
    <div class="cathero__text">
      <img :src="wordmark" :alt="wordmarkAlt" class="cathero__word" width="440" height="137">
      <p v-if="count" class="cathero__count">{{ count }} {{ countLabel }}</p>
    </div>
    <img :src="image" :alt="imageAlt" class="cathero__img" width="1314" height="635">
  </section>
</template>

<style scoped>
.cathero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 220px;
  max-height: 260px;
  margin: var(--space-4) 0 var(--space-2);
  overflow: hidden;
}
.cathero__text {
  flex: 0 1 auto;
  z-index: 1;
}
.cathero__word {
  display: block;
  width: min(100%, 360px);
  height: auto;
}
.cathero__count {
  margin-top: var(--space-3);
  color: var(--mut);
  font-weight: 600;
  font-size: var(--text-md);
}
.cathero__img {
  /* ocupa el espacio a la derecha del wordmark y CENTRA la composición ahí
     (antes iba pegada al borde derecho) */
  flex: 1 1 auto;
  min-width: 0;
  height: 240px;
  object-fit: contain;
  object-position: center;
  display: block;
}

/* mobile: colapsa a wordmark + composición reducida, sin empujar la grilla */
@media (max-width: 720px) {
  .cathero {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-height: 0;
    max-height: none;
    margin-bottom: var(--space-3);
  }
  .cathero__word { width: min(64%, 260px); }
  .cathero__img {
    height: auto;
    width: min(100%, 420px);
    max-width: 100%;
    max-height: 150px;
    object-position: center;
    margin-inline: auto;
  }
}
/* muy angosto: solo el wordmark (la fila de 8 personajes queda ilegible) */
@media (max-width: 420px) {
  .cathero__img { display: none; }
}
</style>
