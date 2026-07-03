<script setup lang="ts">
const { categories, info, contact } = useSiteNav()

const social = [
  { label: 'Instagram', href: '#', icon: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>' },
  { label: 'Facebook', href: '#', icon: '<path d="M14 8h2V5h-2a3 3 0 0 0-3 3v2H9v3h2v6h3v-6h2l1-3h-3V8a1 1 0 0 1 1-1z"/>' },
  { label: 'TikTok', href: '#', icon: '<path d="M14 4c.4 2.3 1.9 3.8 4 4v3c-1.5 0-2.9-.4-4-1.2V16a5 5 0 1 1-5-5c.3 0 .7 0 1 .1v3.1a2 2 0 1 0 1 1.8V4z"/>' },
  { label: 'WhatsApp', href: contact.whatsapp, icon: '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.3A8 8 0 1 1 21 11.5z"/>' },
]

const year = 2026
</script>

<template>
  <footer class="foot">
    <div class="foot__inner">
      <!-- Marca -->
      <div class="foot__brand">
        <div class="flogo">
          <img src="/images/logo-kustom.png" alt="Kustom — Disfraces y Trajes típicos" class="flogoimg">
        </div>
        <p class="ftag">Disfraces para cada historia</p>
        <div class="social">
          <a v-for="s in social" :key="s.label" :href="s.href" class="s" :aria-label="s.label">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="s.icon" />
          </a>
        </div>
      </div>

      <!-- Categorías -->
      <div class="foot__col">
        <h4>Categorías</h4>
        <NuxtLink v-for="c in categories" :key="c.slug" :to="`/categoria/${c.slug}`">
          {{ c.label }}
        </NuxtLink>
      </div>

      <!-- Información -->
      <div class="foot__col">
        <h4>Información</h4>
        <NuxtLink v-for="i in info" :key="i.to" :to="i.to">
          {{ i.label }}
        </NuxtLink>
      </div>

      <!-- Contáctanos -->
      <div class="foot__col">
        <h4>Contáctanos</h4>
        <a class="fcontact" :href="`mailto:${contact.email}`">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          {{ contact.email }}
        </a>
        <div class="fcontact">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          {{ contact.city }}
        </div>
      </div>
    </div>

    <div class="foot__bottom">
      <p class="copy">
        © {{ year }} Kustom Disfraces · Hecho con <span class="heart">♥</span> en Bogotá
      </p>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  background-color: var(--ink);
  /* patrón doodle espacial (bg5 del pack) ATENUADO: overlay carbón encima
     del tile para que el doodle se insinúe como textura de fondo y los
     links de navegación manden. Calibración: si el telescopio/aliens se
     leen como dibujos a primera vista, subir el alpha del overlay. */
  background-image:
    linear-gradient(rgba(17, 17, 17, 0.87), rgba(17, 17, 17, 0.87)),
    url('/images/pattern-ink.webp');
  background-repeat: repeat;
  background-size: auto, 720px auto;
  color: #fff;
  position: relative;
  overflow: hidden;
}
.foot__inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 56px 40px 32px;
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1.3fr;
  gap: 40px;
}

/* ---- marca ---- */
.flogo {
  display: flex;
  line-height: 1;
}
/* logo negro sobre fondo carbón -> invertido a blanco */
.foot .flogoimg {
  height: 52px;
  width: auto;
  display: block;
  filter: invert(1);
}
.foot .ftag {
  color: #A7A49D;
  font-weight: 400;
  margin-top: 14px;
  font-size: 14px;
  max-width: 24ch;
}
.foot .social {
  display: flex;
  gap: 8px;
  margin-top: 18px;
}
.foot .social .s {
  width: 34px;
  height: 34px;
  border: 1px solid #34322D;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #A7A49D;
  transition: all var(--dur-fast) var(--ease-out);
}
.foot .social .s:hover {
  border-color: var(--purple);
  color: #fff;
  background: var(--purple);
}

/* ---- columnas ---- */
.foot__col {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.foot h4 {
  font-size: 11.5px;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-weight: 700;
  margin-bottom: 5px;
  font-family: var(--ff-body);
}
.foot a {
  display: block;
  color: #A7A49D;
  text-decoration: none;
  font-weight: 400;
  font-size: 14px;
}
.foot a:hover { color: #fff; }
.foot .fcontact {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #A7A49D;
  font-size: 14px;
}
.foot .fcontact svg { flex-shrink: 0; }

/* ---- copyright ---- */
.foot__bottom {
  border-top: 1px solid #34322D;
}
.foot .copy {
  max-width: 1280px;
  margin: 0 auto;
  padding: 18px 40px;
  color: #7A776F;
  font-weight: 400;
  font-size: 12.5px;
}
.foot .copy .heart { color: var(--purple); }

/* ---- responsive ---- */
@media (max-width: 1023px) {
  .foot__inner {
    grid-template-columns: 1fr 1fr;
    gap: 32px 24px;
    padding: 40px 20px 24px;
  }
  .foot__brand { grid-column: 1 / -1; }
  .foot .copy { padding: 18px 20px; }
}
@media (max-width: 520px) {
  .foot__inner { grid-template-columns: 1fr; }
}
</style>
