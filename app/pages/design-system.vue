<script setup lang="ts">
// Storybook simple para validación visual del design system.
useHead({ title: 'Design System · Kustom' })

const buttonVariants = ['primary', 'turq', 'ink', 'line', 'ghost'] as const
const sizes = ['sm', 'md', 'lg'] as const
const tagColors = ['purple', 'turq', 'yellow', 'fucsia', 'lima', 'neutral'] as const
const badgeVariants = ['new', 'sale', 'promo', 'soldout', 'neutral'] as const
</script>

<template>
  <main class="ds">
    <header class="ds__head">
      <h1 class="ds__title">Kustom Design System</h1>
      <p class="ds__sub">Componentes UI base · validación visual</p>
    </header>

    <!-- ============ PALETA ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">Paleta</h2>
      <div class="ds__swatches">
        <div v-for="c in [
          { n: 'ink', v: 'var(--ink)' },
          { n: 'purple', v: 'var(--purple)' },
          { n: 'turq', v: 'var(--turq)' },
          { n: 'yellow', v: 'var(--yellow)' },
          { n: 'fucsia', v: 'var(--fucsia)' },
          { n: 'lima', v: 'var(--lima)' },
          { n: 'wa', v: 'var(--wa)' },
          { n: 'hueso', v: 'var(--hueso)' },
        ]" :key="c.n" class="ds__swatch">
          <span class="ds__chip" :style="{ background: c.v }" />
          <code>{{ c.n }}</code>
        </div>
      </div>
    </section>

    <!-- ============ TIPOGRAFÍA ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">Tipografía</h2>
      <p class="ds__display">Luckiest Guy — display</p>
      <p class="ds__body">Bahnschrift / Barlow Semi Condensed — body. 0123456789</p>
    </section>

    <!-- ============ KBUTTON ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">KButton — variantes</h2>
      <div class="ds__row">
        <KButton v-for="v in buttonVariants" :key="v" :variant="v">
          {{ v }}
        </KButton>
        <KButton variant="whatsapp">
          <template #icon-left>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.2 0-.4.1-.5l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5z"/>
            </svg>
          </template>
          WhatsApp
        </KButton>
      </div>
    </section>

    <!-- ============ KBUTTON TAMAÑOS ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">KButton — tamaños</h2>
      <div class="ds__row ds__row--center">
        <KButton v-for="s in sizes" :key="s" :size="s">{{ s }}</KButton>
      </div>
    </section>

    <!-- ============ KBUTTON ESTADOS ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">KButton — estados e iconos</h2>
      <div class="ds__row">
        <KButton :disabled="true">disabled</KButton>
        <KButton :loading="true">loading</KButton>
        <KButton to="/design-system" variant="line">link (NuxtLink)</KButton>
        <KButton variant="turq">
          comprar
          <template #icon-right>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </template>
        </KButton>
      </div>
      <div class="ds__row" style="margin-top: var(--space-4)">
        <KButton :block="true">block (100%)</KButton>
      </div>
    </section>

    <!-- ============ KTAG ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">KTag</h2>
      <div class="ds__row ds__row--center">
        <KTag v-for="c in tagColors" :key="c" :color="c">{{ c }}</KTag>
      </div>
      <div class="ds__row ds__row--center" style="margin-top: var(--space-4)">
        <KTag size="sm" color="purple">sm</KTag>
        <KTag size="md" color="purple">md</KTag>
      </div>
    </section>

    <!-- ============ KBADGE ============ -->
    <section class="ds__section">
      <h2 class="ds__h2">KBadge</h2>
      <div class="ds__row ds__row--center">
        <KBadge v-for="v in badgeVariants" :key="v" :variant="v">{{ v }}</KBadge>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ds {
  max-width: 980px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-8);
}
.ds__head {
  margin-bottom: var(--space-7);
}
.ds__title {
  font-family: var(--ff-display);
  font-size: var(--text-4xl);
  color: var(--purple);
}
.ds__sub {
  color: var(--mut);
  font-size: var(--text-lg);
  margin-top: var(--space-2);
}
.ds__section {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--space-6);
  margin-bottom: var(--space-5);
  box-shadow: var(--shadow-card);
}
.ds__h2 {
  font-family: var(--ff-display);
  font-size: var(--text-xl);
  color: var(--ink);
  margin-bottom: var(--space-5);
}
.ds__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: flex-start;
}
.ds__row--center {
  align-items: center;
}

/* swatches */
.ds__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.ds__swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--mut);
}
.ds__chip {
  width: 56px;
  height: 56px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}

/* tipografía */
.ds__display {
  font-family: var(--ff-display);
  font-size: var(--text-3xl);
  color: var(--ink);
}
.ds__body {
  font-family: var(--ff-body);
  font-size: var(--text-lg);
  color: var(--ink);
  margin-top: var(--space-3);
}
</style>
