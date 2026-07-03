<script setup lang="ts">
/**
 * KButton — botón base del design system Kustom.
 * Variantes según el CSS original aprobado por el cliente.
 * Polimórfico (Decisión 7): si recibe `to`, renderiza <NuxtLink>; si no, <button>.
 */
interface Props {
  variant?: 'primary' | 'turq' | 'ink' | 'line' | 'ghost' | 'whatsapp'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  disabled?: boolean
  loading?: boolean
  to?: string
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false,
  type: 'button',
})

const slots = useSlots()

// Si está deshabilitado o cargando, NO debe ser un link real (a11y): cae a <button>.
const isLink = computed(() => !!props.to && !props.disabled && !props.loading)
const tag = computed(() => (isLink.value ? resolveComponent('NuxtLink') : 'button'))
</script>

<template>
  <component
    :is="tag"
    :to="isLink ? to : undefined"
    :type="isLink ? undefined : type"
    :disabled="!isLink && (disabled || loading) ? true : undefined"
    :aria-busy="loading || undefined"
    :aria-disabled="(disabled || loading) || undefined"
    class="kbtn"
    :class="[
      `kbtn--${variant}`,
      `kbtn--${size}`,
      { 'kbtn--block': block, 'is-loading': loading, 'is-disabled': disabled },
    ]"
  >
    <span v-if="loading" class="kbtn__spinner" aria-hidden="true" />
    <span v-if="slots['icon-left']" class="kbtn__icon"><slot name="icon-left" /></span>
    <span class="kbtn__label"><slot /></span>
    <span v-if="slots['icon-right']" class="kbtn__icon"><slot name="icon-right" /></span>
  </component>
</template>

<style scoped>
.kbtn {
  --kbtn-bg: var(--purple);
  --kbtn-fg: #fff;
  --kbtn-bg-hover: var(--purple-d);
  --kbtn-border: transparent;
  --kbtn-radius: var(--r-md);

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-family: var(--ff-body);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  border: 1.5px solid var(--kbtn-border);
  border-radius: var(--kbtn-radius);
  background-color: var(--kbtn-bg);
  color: var(--kbtn-fg);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
  user-select: none;
}

.kbtn:hover {
  background-color: var(--kbtn-bg-hover);
}
.kbtn:active {
  transform: translateY(1px);
}
.kbtn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--hueso), 0 0 0 5px var(--purple);
}

/* ---------- TAMAÑOS ---------- */
.kbtn--sm {
  height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}
.kbtn--md {
  height: 44px;
  padding: 0 var(--space-5);
  font-size: var(--text-md);
}
.kbtn--lg {
  height: 54px;
  padding: 0 var(--space-6);
  font-size: var(--text-lg);
}

.kbtn--block {
  width: 100%;
}

/* ---------- VARIANTES ---------- */
.kbtn--primary {
  --kbtn-bg: var(--purple);
  --kbtn-fg: #fff;
  --kbtn-bg-hover: var(--purple-d);
}
.kbtn--turq {
  --kbtn-bg: var(--turq);
  --kbtn-fg: var(--ink);
  --kbtn-bg-hover: var(--turq-d);
}
.kbtn--ink {
  --kbtn-bg: var(--ink);
  --kbtn-fg: #fff;
  --kbtn-bg-hover: #000;
}
.kbtn--line {
  --kbtn-bg: transparent;
  --kbtn-fg: var(--purple);
  --kbtn-border: var(--purple);
  --kbtn-bg-hover: var(--purple-soft);
}
.kbtn--ghost {
  --kbtn-bg: transparent;
  --kbtn-fg: var(--ink);
  --kbtn-bg-hover: rgba(17, 17, 17, 0.06);
}
/* WhatsApp: pill verde marca (.wa-pill del CSS original) */
.kbtn--whatsapp {
  --kbtn-bg: var(--wa);
  --kbtn-fg: #fff;
  --kbtn-bg-hover: #1fb858;
  --kbtn-radius: var(--r-pill);
}

/* ---------- ESTADOS ---------- */
.kbtn.is-disabled,
.kbtn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
.kbtn.is-loading {
  cursor: progress;
  pointer-events: none;
}

/* ---------- SPINNER ---------- */
.kbtn__spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--r-pill);
  animation: kbtn-spin 0.6s linear infinite;
}
@keyframes kbtn-spin {
  to { transform: rotate(360deg); }
}

.kbtn__icon {
  display: inline-flex;
  align-items: center;
  font-size: 1.15em;
}
.kbtn__label {
  display: inline-flex;
  align-items: center;
}

@media (prefers-reduced-motion: reduce) {
  .kbtn { transition: none; }
  .kbtn__spinner { animation-duration: 1.5s; }
}
</style>
