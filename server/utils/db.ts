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
// Circuit breaker: tras un fallo de conexión, durante este lapso ready() falla
// RÁPIDO (sin reintentos) para que el bot responda al cliente sin esperar a una
// BD caída — cada función de inbox degrada a memoria (ver inbox.ts).
let schemaFailedAt = 0
const FAIL_COOLDOWN_MS = 30_000

// Reintentos con backoff para el COLD START de Neon (el plan free suspende la BD
// tras ~5 min de inactividad y la primera consulta puede fallar mientras despierta).
// Nota: este proyecto usa el driver HTTP de Neon (cada consulta es un fetch), no un
// Pool — no existe connectionTimeoutMillis; el tiempo de espera lo gobiernan el
// timeout del fetch de la plataforma (>>10s) y estos reintentos (≈3.5s extra máx).
const RETRY_DELAYS_MS = [500, 1000, 2000]

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn()
    }
    catch (err) {
      lastErr = err
      if (i === RETRY_DELAYS_MS.length) break
      console.warn(`[db] ${label} falló (intento ${i + 1}/${RETRY_DELAYS_MS.length + 1}) — reintento en ${RETRY_DELAYS_MS[i]}ms:`, String((err as Error)?.message ?? err))
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[i]))
    }
  }
  throw lastErr
}

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
  // Anti-spam de avisos (correo + WhatsApp al encargado): último aviso por conversación.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ultimo_aviso_at TIMESTAMPTZ`,
  // Cuándo pasó a estado=humano por última vez (para el auto-retorno al bot a los 30 min).
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS humano_at TIMESTAMPTZ`,
  // DEDUPE de reintentos de Meta: un entrante se marca replied_at SOLO cuando el bot
  // envió la respuesta con éxito. Un reintento del mismo wamid sin replied_at puede
  // volver a responder (antes un duplicado guardado ya no volvía a intentarse).
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ`,
  // BANDEJA v2 — medios (imágenes, audios, documentos…) guardados en la propia BD
  // (BYTEA, máx. 4 MB por archivo: límite de respuesta de Vercel). `token` es la
  // clave PÚBLICA e inadivinable con la que se sirve en /api/media/<token>.
  `CREATE TABLE IF NOT EXISTS media (
    id         BIGSERIAL PRIMARY KEY,
    token      TEXT NOT NULL UNIQUE,
    mime       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    filename   TEXT,
    data       BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Tipo del mensaje (text|image|sticker|audio|video|document|location|contacts|
  // reaction|unsupported), archivo asociado y metadatos (caption, coordenadas,
  // nombre de archivo, motivo si no se pudo descargar…).
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'text'`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id BIGINT REFERENCES media(id) ON DELETE SET NULL`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta JSONB`,
  // Identidad del cliente de WhatsApp: teléfono (si Meta lo entrega), BSUID
  // (identidad nueva, p. ej. CO.1041…) y username. external_id sigue siendo la
  // clave de la conversación; estos son datos de contacto para la bandeja.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS telefono TEXT`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bsuid TEXT`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS username TEXT`,
  // Cuándo se archivó (estado='cerrado' = "Archivada" en la bandeja; nunca se borra).
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archivada_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id)`,
  `CREATE INDEX IF NOT EXISTS conversations_actividad_idx ON conversations (ultima_actividad DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_wamid_idx ON messages (wamid) WHERE wamid IS NOT NULL`,
]

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    // Fallo reciente → no volver a esperar reintentos: el llamador degrada a
    // memoria de inmediato y el cliente recibe su respuesta sin demora.
    if (Date.now() - schemaFailedAt < FAIL_COOLDOWN_MS) {
      return Promise.reject(new Error('db_en_cooldown_tras_fallo (se reintenta en <30s)'))
    }
    schemaReady = (async () => {
      const q = sql()
      // PRIMERA consulta con reintentos 500ms/1s/2s: cubre el cold start de Neon.
      await withRetry(() => q.query(MIGRATION[0]), 'primera consulta (cold start)')
      for (const stmt of MIGRATION.slice(1)) await q.query(stmt)
      schemaFailedAt = 0
    })().catch((err) => {
      schemaReady = null // permitir reintento en la siguiente petición
      schemaFailedAt = Date.now()
      throw err
    })
  }
  return schemaReady
}
