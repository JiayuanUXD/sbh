/**
 * M0 数据基线快照。
 *
 * 保存实际数据库表结构、记录数，以及最多 3 条只含 id/时间戳的脱敏样本。
 * PostgreSQL 使用 Payload Local API 并保持 overrideAccess。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { CollectionSlug } from 'payload'

import pkg from '../package.json' with { type: 'json' }

type BaselineItem = {
  slug: string
  fieldCount: number
  topLevelFieldNames: string[]
  recordCount: number
  samples: Array<Record<string, unknown>>
}

async function capturePostgres(): Promise<BaselineItem[]> {
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const payload = await getPayload({ config })

  try {
    const items: BaselineItem[] = []
    for (const collection of payload.config.collections) {
      const slug = collection.slug as CollectionSlug
      const fields = collection.fields ?? []
      const result = await payload.find({
        collection: slug,
        depth: 0,
        limit: 3,
        pagination: false,
        overrideAccess: true,
        select: { id: true, createdAt: true, updatedAt: true },
      })
      items.push({
        slug,
        fieldCount: fields.length,
        topLevelFieldNames: fields.map((field) =>
          'name' in field && typeof field.name === 'string' ? field.name : '(unnamed)',
        ),
        recordCount: result.totalDocs,
        samples: result.docs.map((doc) => {
          const value = doc as { id: number | string; createdAt?: string; updatedAt?: string }
          return { id: value.id, createdAt: value.createdAt, updatedAt: value.updatedAt }
        }),
      })
    }
    return items
  } finally {
    await payload.db.destroy?.()
  }
}

async function capture(): Promise<void> {
  const database = 'postgres'
  const collections = await capturePostgres()
  const snapshot = {
    capturedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      pnpm: pkg.packageManager,
      payload: pkg.dependencies.payload,
      next: pkg.dependencies.next,
      postgresAdapter: pkg.dependencies['@payloadcms/db-postgres'],
    },
    database,
    collections,
    totals: {
      collections: collections.length,
      records: collections.reduce((sum, item) => sum + item.recordCount, 0),
    },
  }

  const outputDir = resolve(process.cwd(), '.baseline')
  const outputFile = resolve(outputDir, 'snapshot.json')
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(`[baseline] snapshot saved → ${outputFile}`)
  console.log(
    `[baseline] tables=${snapshot.totals.collections} records=${snapshot.totals.records} db=${database}`,
  )
}

capture()
  .catch((error: unknown) => {
    console.error('[baseline] capture failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    // 同 migrate-verify：PG 适配器 destroy 后残留连接 handle，进程不退出、CI job hang。
    process.exit(process.exitCode || 0)
  })
