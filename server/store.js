import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Snapshot storage for room documents. Each room is stored as a single
 * Yjs state update (the full document), overwritten on every save.
 *
 * - DATABASE_URL set  -> PostgreSQL (table `rooms`)
 * - otherwise         -> one binary file per room in DATA_DIR (default ./data)
 */
export async function createStore() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id         TEXT PRIMARY KEY,
        state      BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
    return {
      kind: 'postgres',
      async load(id) {
        const { rows } = await pool.query('SELECT state FROM rooms WHERE id = $1', [id])
        return rows.length ? new Uint8Array(rows[0].state) : null
      },
      async save(id, state) {
        await pool.query(
          `INSERT INTO rooms (id, state, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
          [id, Buffer.from(state)]
        )
      },
      close: () => pool.end(),
    }
  }

  const dir = process.env.DATA_DIR || path.join(here, 'data')
  await fs.mkdir(dir, { recursive: true })
  const file = (id) => path.join(dir, `${id}.bin`)
  return {
    kind: `files (${dir})`,
    async load(id) {
      try {
        return new Uint8Array(await fs.readFile(file(id)))
      } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
      }
    },
    async save(id, state) {
      // Write-then-rename so a crash mid-write never leaves a corrupt snapshot.
      const tmp = `${file(id)}.tmp`
      await fs.writeFile(tmp, state)
      await fs.rename(tmp, file(id))
    },
    close: async () => {},
  }
}
