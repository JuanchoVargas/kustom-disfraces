<script setup lang="ts">
// Iconos como path SVG (24x24, stroke). Estáticos y de confianza -> v-html seguro.
const items = [
  {
    title: 'Envío a toda Colombia',
    sub: 'Despachos en 24–48h',
    icon: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  },
  {
    title: 'Pago contra entrega',
    sub: 'Paga al recibir tu pedido',
    icon: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  },
  {
    title: 'Compra 100% segura',
    sub: 'Tus datos protegidos',
    icon: '<path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  },
  {
    title: 'Asesoría por WhatsApp',
    sub: 'Te ayudamos a elegir',
    icon: '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.3A8 8 0 1 1 21 11.5z"/>',
  },
]
</script>

<template>
  <section class="trust">
    <div class="trust__inner">
      <div v-for="(it, i) in items" :key="i" class="ti">
        <span class="ic">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="it.icon" />
        </span>
        <span class="tx">
          {{ it.title }}
          <s>{{ it.sub }}</s>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Banda ligera: sin fondo ni bordes (se funde con el hueso), con respiro
   propio para no pegarse al navbar ni al contenido */
.trust {
  margin: var(--space-5) 0;
}
.trust__inner {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 40px;
}
.ti {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ink);
}
.ti .ic {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--mut);
}
.ti .ic svg {
  width: 17px;
  height: 17px;
}
.ti .tx {
  font-weight: 600;
  font-size: 12.5px;
  line-height: 1.25;
}
.ti .tx s {
  display: block;
  font-weight: 400;
  font-size: 11px;
  color: var(--mut-2);
  text-decoration: none;
  margin-top: 1px;
}

/* Mobile: scroll horizontal en vez de comprimir */
@media (max-width: 1023px) {
  .trust {
    margin: var(--space-4) 0;
  }
  .trust__inner {
    justify-content: flex-start;
    gap: 22px;
    padding: 0 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .trust__inner::-webkit-scrollbar { display: none; }
  .ti { flex: 0 0 auto; }
}
</style>
