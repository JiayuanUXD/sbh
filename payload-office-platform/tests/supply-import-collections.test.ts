import { describe, expect, it } from 'vitest'

import { SupplyImportBatches } from '@/collections/SupplyImportBatches'
import { LocationAliases } from '@/collections/LocationAliases'
import { Buildings } from '@/collections/Buildings'
import { Listings } from '@/collections/Listings'

/** 从 collection 配置里按 name 深度查找字段（跨 tabs / row / group）。 */
function findField(fields: unknown, name: string): Record<string, unknown> | null {
  if (!Array.isArray(fields)) return null
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue
    const field = raw as Record<string, unknown>
    if (field.name === name) return field
    for (const key of ['fields', 'tabs']) {
      const nested = findField(field[key], name)
      if (nested) return nested
    }
  }
  return null
}

describe('OPT-041 导入相关集合契约', () => {
  it('supply-import-batches 的 status 覆盖全部五个状态', () => {
    expect(SupplyImportBatches.slug).toBe('supply-import-batches')
    const status = findField(SupplyImportBatches.fields, 'status')
    const values = (status?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['preflight', 'queued', 'running', 'completed', 'failed'])
  })

  it('location-aliases 的 kind 与 LOCATION_TYPES 对齐（不含 metro_line）', () => {
    const kind = findField(LocationAliases.fields, 'kind')
    const values = (kind?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['city', 'district', 'business_area', 'metro_station'])
  })

  it('Listings.dataSource.source 增加 manual-import', () => {
    const source = findField(Listings.fields, 'source')
    const values = (source?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toContain('manual-import')
    expect(values).toContain('huizuxuanzhi')
  })

  it('Buildings 拥有与 Listings 同构的 dataSource 组', () => {
    for (const name of ['source', 'externalId', 'syncedAt', 'sourceUrl']) {
      expect(findField(Buildings.fields, name), `Buildings 缺 ${name}`).not.toBeNull()
    }
  })
})
