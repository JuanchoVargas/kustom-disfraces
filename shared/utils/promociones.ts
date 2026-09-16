import promocionesData from '../../app/data/promociones.json'

/**
 * PROMOCIONES POR FECHA (p. ej. Batman Day). Único lugar que decide si un código
 * está en promoción y cuánto vale con descuento. Lo usan:
 *  - server/utils/pricing.ts        → precio que se COBRA y se valida en el checkout
 *  - server/utils/promoClock.ts     → decide "ahora" con el reloj del SERVIDOR
 *  - app/composables/useProducts.ts → precio/tachado/cinta de PLP y PDP (con la
 *                                     decisión hidratada desde /api/promociones,
 *                                     nunca con el reloj del navegador)
 *  - el bot y el correo             → mismo cálculo
 *
 * La promoción vive en app/data/promociones.json (versionada, sin variables ni
 * Woo). Fuera de las fechas todo se comporta exactamente como si no existiera.
 * El descuento NO se acumula con el tachado ficticio del 20 %: un producto en
 * promoción lleva regularPrice = precio pleno y la UI calcula el % real.
 */
export interface Promocion {
  id: string
  nombre: string
  /** Códigos de referencia del catálogo (sin talla). */
  codigos: string[]
  /** Porcentaje de descuento sobre el precio de venta actual. */
  pct: number
  /** ISO con zona horaria; inclusive. */
  desde: string
  /** ISO con zona horaria; inclusive (p. ej. 23:59:59-05:00). */
  hasta: string
  /** Texto de condiciones que muestra la PDP. */
  texto: string
}

/** Lo que viaja a la UI y a los mensajes: la promoción ya decidida por el servidor. */
export interface PromocionActiva {
  id: string
  nombre: string
  pct: number
  codigos: string[]
  texto: string
  desde: string
  hasta: string
}

export const PROMOCIONES: Promocion[] = promocionesData as Promocion[]

/** ¿Está vigente en el instante `ahora`? Bordes inclusivos. */
export function promocionVigente(p: Promocion, ahora: Date): boolean {
  const t = ahora.getTime()
  const desde = Date.parse(p.desde)
  const hasta = Date.parse(p.hasta)
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return false
  return t >= desde && t <= hasta
}

/** Promociones vigentes en `ahora` (reloj del SERVIDOR), listas para hidratar. */
export function promocionesVigentes(ahora: Date, lista: Promocion[] = PROMOCIONES): PromocionActiva[] {
  return lista
    .filter(p => promocionVigente(p, ahora))
    .map(p => ({ id: p.id, nombre: p.nombre, pct: p.pct, codigos: [...p.codigos], texto: p.texto, desde: p.desde, hasta: p.hasta }))
}

/** Promoción activa que cubre un código, o null. Con varias, gana la primera del archivo. */
export function promoDeCodigo(codigo: string | undefined, activas: PromocionActiva[]): PromocionActiva | null {
  if (!codigo) return null
  return activas.find(p => p.codigos.includes(codigo)) ?? null
}

/** Precio con descuento: entero en pesos, redondeado al peso más cercano. */
export function precioConDescuento(precioPleno: number, pct: number): number {
  return Math.round(precioPleno * (1 - pct / 100))
}

/**
 * Precio efectivo de un código: { precio, precioPleno, promo }. Si no hay promoción
 * activa para ese código, precio === precioPleno y promo === null.
 */
export function precioEfectivo(codigo: string | undefined, precioPleno: number, activas: PromocionActiva[]): { precio: number, precioPleno: number, promo: PromocionActiva | null } {
  const promo = promoDeCodigo(codigo, activas)
  if (!promo || !(precioPleno > 0)) return { precio: precioPleno, precioPleno, promo: null }
  return { precio: precioConDescuento(precioPleno, promo.pct), precioPleno, promo }
}
