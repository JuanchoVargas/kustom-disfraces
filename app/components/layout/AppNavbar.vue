<script setup lang="ts">
const { categories, contact } = useSiteNav()

// Contador real desde el store de carrito (Pinia).
const cart = useCartStore()
const cartCount = computed(() => cart.count)

// Micro-feedback: el cartdot hace "pop" cuando se agrega un item.
const popping = ref(false)
watch(() => cart.count, (n, o) => {
  if (n > o) {
    popping.value = true
    setTimeout(() => { popping.value = false }, 450)
  }
})

// Categoría activa según la ruta actual.
const route = useRoute()
const activeSlug = computed(() => {
  const m = route.path.match(/^\/categoria\/([^/]+)/)
  return m?.[1] ?? null
})

// En la PLP las CategoryTabs ya muestran las categorías: la fila de chips
// del navbar mobile se oculta ahí para no duplicar (en Home y demás sigue).
const onCategoryPage = computed(() => activeSlug.value !== null)
</script>

<template>
  <!-- ===================== DESKTOP ===================== -->
  <div class="d">
    <nav class="nav">
      <NuxtLink to="/" class="logo">
        <img src="/images/logo-kustom.png" alt="Kustom — Disfraces y Trajes típicos" class="logoimg">
      </NuxtLink>

      <div class="links">
        <NuxtLink
          v-for="c in categories"
          :key="c.slug"
          :to="`/categoria/${c.slug}`"
          :class="{ on: c.slug === activeSlug }"
        >{{ c.label }}</NuxtLink>
      </div>

      <div class="icons">
        <button class="iconbtn" type="button" aria-label="Buscar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
        </button>

        <button type="button" class="iconbtn" aria-label="Abrir carrito" @click="cart.openDrawer()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 7h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
            <path d="M9 7a3 3 0 0 1 6 0" />
          </svg>
          <span v-if="cartCount" class="cartdot" :class="{ pop: popping }">{{ cartCount }}</span>
        </button>

        <KButton variant="whatsapp" size="sm" :to="contact.whatsapp">
          <template #icon-left>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.2 0-.4.1-.5l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5z"/>
            </svg>
          </template>
          WhatsApp
        </KButton>
      </div>
    </nav>
  </div>

  <!-- ===================== MOBILE ===================== -->
  <div class="m">
    <nav class="nav">
      <div class="top">
        <NuxtLink to="/" class="logo">
          <img src="/images/logo-kustom.png" alt="Kustom — Disfraces y Trajes típicos" class="logoimg">
        </NuxtLink>

        <div class="icons">
          <button type="button" class="iconbtn" aria-label="Abrir carrito" @click="cart.openDrawer()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 7h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
              <path d="M9 7a3 3 0 0 1 6 0" />
            </svg>
            <span v-if="cartCount" class="cartdot" :class="{ pop: popping }">{{ cartCount }}</span>
          </button>

          <KButton variant="whatsapp" size="sm" :to="contact.whatsapp" aria-label="WhatsApp">
            <template #icon-left>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.2 0-.4.1-.5l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5z"/>
              </svg>
            </template>
            WhatsApp
          </KButton>
        </div>
      </div>

      <label class="search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color: var(--mut); flex-shrink: 0">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input type="search" placeholder="Buscar disfraces, tallas, personajes…" >
      </label>

      <div v-if="!onCategoryPage" class="chiprow">
        <NuxtLink
          v-for="c in categories"
          :key="c.slug"
          :to="`/categoria/${c.slug}`"
          class="chip"
          :class="{ on: c.slug === activeSlug }"
        >{{ c.label }}</NuxtLink>
      </div>
    </nav>
  </div>
</template>

<style scoped>
/* ---- alternancia desktop / mobile (breakpoint 1024px) ---- */
.d { display: none; }
.m { display: block; }
@media (min-width: 1024px) {
  .d { display: block; }
  .m { display: none; }
}

/* ===================== DESKTOP (.d .nav) — port exacto ===================== */
.d .nav {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 26px;
  padding: 16px 40px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.d .nav .links {
  display: flex;
  gap: 2px;
  flex: 1;
  justify-content: center;
}
.d .nav .links a {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--ink);
  text-decoration: none;
  padding: 8px 12px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.d .nav .links a:hover { color: var(--purple); }
.d .nav .links a.on { color: var(--purple); }
.d .nav .icons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ===================== MOBILE (.m .nav) — port exacto ===================== */
.m .nav {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 14px 16px 12px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.m .nav .top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.m .nav .icons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.m .logoimg { height: 38px; }
.m .search {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 9px 15px;
  background: var(--hueso);
}
.m .search input {
  border: 0;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  width: 100%;
  outline: none;
  color: var(--ink);
  font-family: var(--ff-body);
}
.m .chiprow {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  scrollbar-width: none;
}
.m .chiprow::-webkit-scrollbar { display: none; }
.m .chip {
  font-weight: 600;
  font-size: 12px;
  padding: 6px 13px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  white-space: nowrap;
  background: #fff;
  color: var(--ink);
  text-decoration: none;
}
.m .chip.on {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}

/* ===================== compartido: logo + iconbtn + cartdot ===================== */
.logo {
  display: flex;
  align-items: center;
  text-decoration: none;
  flex-shrink: 0;
}
/* Logo-Kustom.png (wordmark negro + tagline, fondo transparente) */
.logoimg {
  height: 46px;
  width: auto;
  display: block;
}
.iconbtn {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  display: grid;
  place-items: center;
  position: relative;
  cursor: pointer;
  color: var(--ink);
  flex-shrink: 0;
}
.iconbtn:hover { background: var(--hueso); }
.cartdot {
  position: absolute;
  top: 3px;
  right: 3px;
  background: var(--purple);
  color: #fff;
  font-weight: 700;
  font-size: 9px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}
/* Pop al agregar al carrito (sutil) */
.cartdot.pop {
  animation: cartpop 0.45s var(--ease-out);
}
@keyframes cartpop {
  0% { transform: scale(1); }
  35% { transform: scale(1.4); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cartdot.pop { animation: none; }
}
</style>
