import { sqliteAdapter } from '@payloadcms/db-sqlite'

type SQLiteAdapterArgs = Parameters<typeof sqliteAdapter>[0]
type SQLiteDatabaseAdapter = ReturnType<typeof sqliteAdapter>

type SharedSQLiteConnectState = typeof globalThis & {
  __payloadSQLiteConnectTail?: Promise<void>
}

export async function serializeSQLiteConnect<TResult>(
  connect: () => Promise<TResult>,
): Promise<TResult> {
  const shared = globalThis as SharedSQLiteConnectState
  const previous = shared.__payloadSQLiteConnectTail ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })

  shared.__payloadSQLiteConnectTail = previous.then(() => current)
  await previous

  try {
    return await connect()
  } finally {
    release?.()
  }
}

/**
 * Serialize SQLite adapter connection inside a Next.js server process.
 *
 * Payload performs its development schema push during `connect()`. Next can
 * initialize more than one Payload context concurrently; without a shared
 * mutex both contexts may introspect the same schema and emit an identical
 * CREATE INDEX. The second connection must wait until the first schema push
 * has completed and then introspect the updated database.
 */
export function serializedSQLiteAdapter(args: SQLiteAdapterArgs): SQLiteDatabaseAdapter {
  const databaseAdapter = sqliteAdapter(args)
  const initialize = databaseAdapter.init

  return {
    ...databaseAdapter,
    init(initArgs) {
      const adapter = initialize(initArgs)
      const originalConnect = adapter.connect
      if (!originalConnect) return adapter
      const connect = originalConnect.bind(adapter)

      adapter.connect = async (options) => {
        return serializeSQLiteConnect(() => connect(options))
      }

      return adapter
    },
  }
}
