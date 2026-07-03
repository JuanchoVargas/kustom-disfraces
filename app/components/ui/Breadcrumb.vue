<script setup lang="ts">
interface Crumb {
  label: string
  to?: string
}
defineProps<{ items: Crumb[] }>()
</script>

<template>
  <nav class="crumb" aria-label="Migas de pan">
    <template v-for="(c, i) in items" :key="i">
      <NuxtLink v-if="c.to && i < items.length - 1" :to="c.to">{{ c.label }}</NuxtLink>
      <span v-else class="cur">{{ c.label }}</span>
      <span v-if="i < items.length - 1" aria-hidden="true">/</span>
    </template>
  </nav>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--mut-2);
  flex-wrap: wrap;
  font-size: 13px;
}
.crumb a {
  color: var(--mut-2);
  text-decoration: none;
}
.crumb a:hover {
  color: var(--purple);
}
.crumb .cur {
  color: var(--ink);
  font-weight: 600;
}
</style>
