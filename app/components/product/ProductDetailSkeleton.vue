<script setup lang="ts">
// Espejo del top de la PDP (galería + info) para el estado de carga.
</script>

<template>
  <div class="pdp-sk">
    <!-- galería -->
    <div class="pdp-sk__gallery">
      <Skeleton w="100%" h="100%" radius="var(--r-lg)" class="pdp-sk__main" />
      <div class="pdp-sk__thumbs">
        <Skeleton v-for="i in 4" :key="i" w="72px" h="72px" radius="var(--r-md)" />
      </div>
    </div>

    <!-- info -->
    <div class="pdp-sk__info">
      <Skeleton w="90px" h="12px" />
      <Skeleton w="70%" h="30px" />
      <Skeleton w="40%" h="24px" />
      <Skeleton w="100%" h="14px" />
      <Skeleton w="85%" h="14px" />

      <Skeleton w="60px" h="13px" class="pdp-sk__gap" />
      <div class="pdp-sk__row">
        <Skeleton v-for="i in 4" :key="i" w="44px" h="40px" radius="var(--r-pill)" />
      </div>

      <Skeleton w="110px" h="13px" class="pdp-sk__gap" />
      <Skeleton v-for="i in 3" :key="`g${i}`" w="100%" h="56px" radius="var(--r-md)" />

      <Skeleton w="100%" h="54px" radius="var(--r-md)" class="pdp-sk__gap" />
      <Skeleton w="100%" h="54px" radius="var(--r-md)" />
    </div>
  </div>
</template>

<style scoped>
.pdp-sk {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-7);
  margin-top: var(--space-4);
}
.pdp-sk__gallery {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pdp-sk__main {
  aspect-ratio: 1 / 1;
}
.pdp-sk__thumbs {
  display: flex;
  gap: var(--space-3);
}
.pdp-sk__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pdp-sk__gap {
  margin-top: var(--space-4);
}
.pdp-sk__row {
  display: flex;
  gap: var(--space-2);
}

@media (max-width: 900px) {
  .pdp-sk {
    grid-template-columns: 1fr;
    gap: var(--space-5);
  }
}
</style>
