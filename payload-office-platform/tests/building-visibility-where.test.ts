import { describe, expect, it } from 'vitest'

import {
  buildingOperationalWhere,
  listingBuildingOperationalWhere,
} from '@/domain/supply/building'

/**
 * 楼盘有效供给谓词的 where 片段单一真源测试（M3.5 / design §9/§10, R3）
 *
 * 决策:采用正向谓词 equals 'active'（fail-closed，与 isBuildingOperational 同源），
 * 而非 not_equals 'disabled'。停用只从查询侧移除可见性，不改写 Listing 状态。
 */

describe('building-visibility/buildingOperationalWhere', () => {
  it('直接查 buildings 集合:operationalStatus 必须 equals active', () => {
    expect(buildingOperationalWhere()).toEqual({ operationalStatus: { equals: 'active' } })
  })

  it('是 fail-closed 正向谓词,不用 not_equals', () => {
    const frag = buildingOperationalWhere()
    expect(JSON.stringify(frag)).not.toContain('not_equals')
    expect(JSON.stringify(frag)).not.toContain('disabled')
  })
})

describe('building-visibility/listingBuildingOperationalWhere', () => {
  it('经 listing.building 关系子字段查:building.operationalStatus equals active', () => {
    expect(listingBuildingOperationalWhere()).toEqual({
      'building.operationalStatus': { equals: 'active' },
    })
  })
})
