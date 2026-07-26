import { describe, expect, it } from 'vitest'

import {
  serializedSQLiteAdapter,
  serializeSQLiteConnect,
} from '@/lib/serialized-sqlite-adapter'

describe('serializedSQLiteAdapter', () => {
  it('preserves the SQLite adapter identity and initialization contract', () => {
    const adapter = serializedSQLiteAdapter({
      client: { url: 'file::memory:' },
      push: false,
    })

    expect(adapter.name).toBe('sqlite')
    expect(typeof adapter.init).toBe('function')
  })

  it('serializes concurrent connect calls before schema push', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined

    const firstConnect = serializeSQLiteConnect(async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
    })
    const secondConnect = serializeSQLiteConnect(async () => {
      order.push('second:start')
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(order).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([firstConnect, secondConnect])
    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
  })
})
