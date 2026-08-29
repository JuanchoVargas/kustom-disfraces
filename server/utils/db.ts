import { neon } from '@neondatabase/serverless'

/**
 * Conexión a Postgres (Neon) — driver HTTP serverless, apto para Vercel (sin pool
 * persistente). Se lee POSTGRES_URL (la que inyecta la integración Neon↔Vercel);
 * como alternativa DATABASE_URL. Sin URL, `dbConfigured()` es false y el resto
 * del sistema cae al comportamiento en memoria (bot) o responde 503 (bandeja).
 *
 * `ensureSchema()` corre la migración IDEMPOTENTE (CREATE IF NOT EXISTS) una vez
 * por instancia caliente; la llaman los webhooks y la bandeja antes de tocar
 * las tablas, así no hace falta un paso de deploy aparte.
 */

type Sql = ReturnType<typeof neon>
let client: Sql | null = null
let schemaReady: Promise<void> | null = null

export function dbConfigured(): boolean {
  return !!(process.env.POSTGRES_URL || process.env.DATABASE_URL)
}

export function sql(): Sql {
  if (client) return client
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!url) throw new Error('db_not_configured')
  client = neon(url)
  return client
}

const MIGRATION = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id                BIGSERIAL PRIMARY KEY,
    canal             TEXT NOT NULL CHECK (canal IN ('wa','msg','ig')),
    external_id       TEXT NOT NULL,
    nombre            TEXT,
    ultimo_mensaje    TEXT,
    ultima_actividad  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_cliente_at TIMESTAMPTZ,
    estado            TEXT NOT NULL DEFAULT 'bot' CHECK (estado IN ('bot','humano','cerrado')),
    no_leidos         INTEGER NOT NULL DEFAULT 0,
    bot_state         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (canal, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direccion       TEXT NOT NULL CHECK (direccion IN ('in','out')),
    texto           TEXT NOT NULL,
    autor           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    wamid           TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id)`,
  `CREATE INDEX IF NOT EXISTS conversations_actividad_idx ON conversations (ultima_actividad DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_wamid_idx ON messages (wamid) WHERE wamid IS NOT NULL`,
]

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const q = sql()
      for (const stmt of MIGRATION) await q.query(stmt)
    })().catch((err) => {
      schemaReady = null // permitir reintento en la siguiente petición
      throw err
    })
  }
  return schemaReady
}
