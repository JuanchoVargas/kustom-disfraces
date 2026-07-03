<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Preview · Componentes de dominio' })

const { products, categories } = useProducts()

const size = ref<string | number | null>(6)
const gama = ref<string | null>('Súper Acolchado')
</script>

<template>
  <main class="pv">
    <header class="pv__head">
      <h1 class="pv__title">Componentes de dominio</h1>
      <p class="pv__sub">ProductCard · CategoryCard · SizeSelector · GamaSelector · KoBlock</p>
    </header>

    <section class="pv__section">
      <h2 class="pv__h2">ProductCard</h2>
      <div class="grid grid--cards">
        <ProductCard v-for="(p, i) in products" :key="i" :product="p" />
      </div>
    </section>

    <section class="pv__section">
      <h2 class="pv__h2">CategoryCard</h2>
      <div class="grid grid--cats">
        <CategoryCard v-for="c in categories" :key="c.slug" :name="c.name" :slug="c.slug" />
      </div>
    </section>

    <section class="pv__section">
      <h2 class="pv__h2">SizeSelector <small>(seleccionada: {{ size ?? '—' }} · talla 10 agotada)</small></h2>
      <SizeSelector v-model="size" />
    </section>

    <section class="pv__section">
      <h2 class="pv__h2">GamaSelector <small>(seleccionada: {{ gama ?? '—' }})</small></h2>
      <GamaSelector v-model="gama" />
    </section>

    <section class="pv__section">
      <h2 class="pv__h2">KoBlock</h2>
      <KoBlock />
    </section>
  </main>
</template>

<style scoped>
.pv {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-8);
}
.pv__head {
  margin-bottom: var(--space-6);
}
.pv__title {
  font-family: var(--ff-display);
  font-size: var(--text-4xl);
  color: var(--purple);
}
.pv__sub {
  color: var(--mut);
  font-size: var(--text-md);
  margin-top: var(--space-2);
}
.pv__section {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--space-6);
  margin-bottom: var(--space-5);
  box-shadow: var(--shadow-card);
}
.pv__h2 {
  font-family: var(--ff-display);
  font-size: var(--text-xl);
  color: var(--ink);
  margin-bottom: var(--space-5);
}
.pv__h2 small {
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  color: var(--mut);
  font-weight: 500;
}
.grid {
  display: grid;
  gap: var(--space-4);
}
.grid--cards {
  grid-template-columns: repeat(4, 1fr);
}
.grid--cats {
  grid-template-columns: repeat(4, 1fr);
}
@media (max-width: 760px) {
  .grid--cards,
  .grid--cats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
