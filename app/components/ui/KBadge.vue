<script setup lang="ts">
/**
 * KBadge — distintivo sólido y compacto (estado de producto).
 * Pensado para superponerse en ProductCard ("NUEVO", "-20%", "AGOTADO").
 * Primera versión basada en tokens; ajustable al CSS original .badge si existe.
 */
interface Props {
  variant?: 'new' | 'sale' | 'promo' | 'soldout' | 'neutral'
}
withDefaults(defineProps<Props>(), {
  variant: 'new',
})
</script>

<template>
  <span class="kbadge" :class="`kbadge--${variant}`">
    <slot />
  </span>
</template>

<style scoped>
.kbadge {
  display: inline-flex;
  align-items: center;
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1;
  padding: 4px var(--space-2);
  border-radius: var(--r-sm);
  color: #fff;
}

/* ---------- VARIANTES ---------- */
.kbadge--new {
  background: var(--turq);
  color: var(--ink);
}
.kbadge--sale {
  background: var(--fucsia);
}
.kbadge--promo {
  background: var(--yellow);
  color: var(--ink);
}
.kbadge--soldout {
  background: var(--mut);
}
.kbadge--neutral {
  background: var(--ink);
}
</style>
