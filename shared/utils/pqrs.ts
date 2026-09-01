/**
 * Motivos del formulario PQRS — lista ÚNICA compartida entre la página /pqrs
 * (selector) y el endpoint /api/pqrs (validación server-side): agregar o quitar
 * un motivo aquí actualiza ambos lados.
 */
export const MOTIVOS_PQRS = [
  'Petición',
  'Queja',
  'Reclamo',
  'Sugerencia',
  'Estado de mi pedido',
  'Garantías y cambios',
  'Otro',
] as const

export type MotivoPqrs = typeof MOTIVOS_PQRS[number]
