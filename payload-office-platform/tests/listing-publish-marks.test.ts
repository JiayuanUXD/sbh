import { describe, expect, it } from 'vitest'

import { Listings } from '@/collections/Listings'
import {
  FIELD_FOR_KEY,
  UNMARKABLE,
  allSubmitRequiredKeys,
  publishRequiredFieldNames,
  unmappedSubmitRequiredKeys,
} from '@/collections/listing-publish-marks'
import {
  DRAFT_REQUIRED_FIELDS,
  getSubmitRequiredFields,
} from '@/domain/review/listing-completeness'

/**
 * 发布必填标记（OPT-032 §3.3-E / 方案 B）。
 *
 * 这组测试的核心价值是**第一条**：以后往 `getSubmitRequiredFields` 里加发布条件、
 * 却忘了在表单上标出来，这里会红。没有它，方案 B 就只是一次性的手工装饰，
 * 下一个加字段的人不会知道还有个映射表要同步。
 */

type AnyField = Record<string, any>

function walk(nodes: AnyField[], visit: (node: AnyField) => void) {
  for (const node of nodes) {
    visit(node)
    if (Array.isArray(node.fields)) walk(node.fields, visit)
    if (Array.isArray(node.tabs)) walk(node.tabs, visit)
  }
}

const byName = new Map<string, AnyField>()
walk(Listings.fields as AnyField[], (n) => {
  if (n.name) byName.set(n.name, n)
})

describe('listing-publish-marks/映射完整性', () => {
  it('每个发布必填键要么有表单落点、要么显式登记为标不了', () => {
    // 漏一个键就意味着：该条件在表单上完全不可见，运营填完点提交才被拦
    expect(unmappedSubmitRequiredKeys()).toEqual([])
  })

  it('租售两种口径的必填键都被覆盖', () => {
    for (const biz of ['lease', 'sale'] as const) {
      for (const key of getSubmitRequiredFields(biz)) {
        expect(UNMARKABLE.has(key) || Boolean(FIELD_FOR_KEY[key])).toBe(true)
      }
    }
  })

  it('标不了的只有 gallery，且理由成立（admin.hidden 的派生数组，界面上无 label 可挂）', () => {
    expect([...UNMARKABLE]).toEqual(['gallery'])
    expect(byName.get('gallery')?.admin?.hidden).toBe(true)
  })

  it('映射表里的每个目标字段都真实存在于 Listings', () => {
    for (const [key, fieldName] of Object.entries(FIELD_FOR_KEY)) {
      expect(byName.has(fieldName), `${key} → ${fieldName} 不存在`).toBe(true)
    }
  })
})

describe('listing-publish-marks/装配到字段', () => {
  it('该标的字段都挂上了 PublishRequiredLabel', () => {
    const missing: string[] = []
    for (const name of publishRequiredFieldNames()) {
      const field = byName.get(name)
      const label = field?.admin?.components?.Label
      const path = typeof label === 'object' ? label?.path : label
      if (typeof path !== 'string' || !path.includes('PublishRequiredLabel')) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it('不该标的字段没有被误标', () => {
    const shouldMark = publishRequiredFieldNames()
    const wrong: string[] = []
    for (const [name, field] of byName) {
      const label = field?.admin?.components?.Label
      const path = typeof label === 'object' ? label?.path : label
      if (typeof path === 'string' && path.includes('PublishRequiredLabel') && !shouldMark.has(name)) {
        wrong.push(name)
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('listing-publish-marks/两级门槛不被打死', () => {
  it('发布必填字段绝不能被改成 required: true', () => {
    // 房源是两级门槛：草稿随写随存，提交审核才全量校验
    // （见 domain/review/listing-completeness.ts 头注释）。
    // 把发布必填改成 required 会让运营连半成品都存不下——标记必须是纯视觉的。
    const draftGate = new Set<string>(DRAFT_REQUIRED_FIELDS)
    const wronglyRequired: string[] = []
    for (const key of allSubmitRequiredKeys()) {
      if (draftGate.has(key)) continue // 草稿门槛内的三项本来就该是 required
      const fieldName = FIELD_FOR_KEY[key]
      if (!fieldName) continue
      if (byName.get(fieldName)?.required === true) wronglyRequired.push(fieldName)
    }
    expect(wronglyRequired).toEqual([])
  })

  it('草稿门槛的三项仍然是 required（这一级不该被顺手拆掉）', () => {
    for (const key of DRAFT_REQUIRED_FIELDS) {
      expect(byName.get(key)?.required, `${key} 应为 required`).toBe(true)
    }
  })
})
