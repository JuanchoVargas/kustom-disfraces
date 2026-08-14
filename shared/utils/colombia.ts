/**
 * Departamentos de Colombia (para el select del checkout) y tipos de documento.
 * Compartido cliente/servidor (Nuxt 4 shared).
 */
export const DEPARTAMENTOS_CO: string[] = [
  'Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 'Bolívar',
  'Boyacá', 'Caldas', 'Caquetá', 'Casanare', 'Cauca', 'Cesar', 'Chocó',
  'Córdoba', 'Cundinamarca', 'Guainía', 'Guaviare', 'Huila', 'La Guajira',
  'Magdalena', 'Meta', 'Nariño', 'Norte de Santander', 'Putumayo', 'Quindío',
  'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre', 'Tolima',
  'Valle del Cauca', 'Vaupés', 'Vichada',
]

export const TIPOS_DOCUMENTO = ['CC', 'CE', 'NIT'] as const
export type TipoDocumento = typeof TIPOS_DOCUMENTO[number]

/** Datos del comprador capturados en /checkout (factura + envío). */
export interface CheckoutBuyer {
  nombre: string
  tipoDocumento: TipoDocumento
  documento: string
  email: string
  telefono: string
  direccion: string
  ciudad: string
  departamento: string
  notas?: string
}
