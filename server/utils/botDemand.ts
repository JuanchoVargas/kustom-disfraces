import { dbConfigured, ensureSchema, sql } from './db'

/**
 * REGISTRO DE BÚSQUEDAS FALLIDAS del bot (reporte de demanda). Cada "no
 * encontré" deja una fila con canal, texto exacto, término normalizado, motivo
 * y las sugerencias ofrecidas; además se loguea con el prefijo [bot-nf] para
 * verlo en Vercel. Nunca lanza: un fallo de BD no puede callar al bot.
 */
export interface FailedSearch {
  canal: string
  externalId?: string
  texto: string
  termino: string
  motivo: 'sin_coincidencia' | 'solo_parecidos' | 'sin_tokens'
  sugerencias: { slug: string, nombre: string, score: number, motivo: string }[]
}

export async function recordFailedSearch(f: FailedSearch): Promise<void> {
  console.warn(`[bot-nf] canal=${f.canal} from=${f.externalId ?? '—'} motivo=${f.motivo} texto=${JSON.stringify(f.texto)} termino=${JSON.stringify(f.termino)} sugerencias=${f.sugerencias.map(s => `${s.slug}(${s.score},${s.motivo})`).join(',') || 'ninguna'}`)
  if (!dbConfigured()) return
  try {
    await ensureSchema()
    await sql().query(
      `INSERT INTO bot_busquedas_fallidas (canal, external_id, texto, termino, motivo, sugerencias) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [f.canal, f.externalId ?? null, f.texto.slice(0, 500), f.termino.slice(0, 200), f.motivo, JSON.stringify(f.sugerencias)],
    )
  }
  catch (err) {
    console.error('[bot-nf] no se pudo guardar la búsqueda fallida:', String((err as Error)?.message ?? err))
  }
}

export interface DemandRow { termino: string, veces: number, ultima: string, canales: string[], ejemplo: string }

/** Términos no encontrados agrupados (más pedidos primero), para el reporte de demanda. */
export async function demandReport(opts: { desde?: string, limit?: number } = {}): Promise<DemandRow[]> {
  if (!dbConfigured()) return []
  await ensureSchema()
  const rows = await sql().query(
    `SELECT termino, count(*)::int AS veces, max(created_at) AS ultima,
            array_agg(DISTINCT canal) AS canales, (array_agg(texto ORDER BY created_at DESC))[1] AS ejemplo
     FROM bot_busquedas_fallidas
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
     GROUP BY termino ORDER BY veces DESC, ultima DESC LIMIT $2`,
    [opts.desde ?? null, Math.min(Math.max(opts.limit ?? 100, 1), 500)],
  ) as any[]
  return rows.map(r => ({ termino: r.termino, veces: Number(r.veces), ultima: new Date(r.ultima).toISOString(), canales: r.canales ?? [], ejemplo: r.ejemplo }))
}
