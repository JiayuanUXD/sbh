import { describe, expect, it } from 'vitest'

import { Listings } from '@/collections/Listings'
import {
  LOCATE_FOR_KEY,
  allLocatableCompletenessKeys,
  locateForCompletenessField,
  unmappedCompletenessKeys,
} from '@/domain/review/listing-completeness-locate'

/**
 * D 项「房源信息不足的引导」的定位映射守卫。
 *
 * 点击定位全部按**文本**匹配（tab 按钮文字、字段 label 文字），Payload 不给字段
 * 渲染稳定的 data 属性。所以这张映射表一旦与 collection 配置对不上，点击就静默
 * 不动作——没有报错、没有日志，只有「点了没反应」。这组用例把两边钉在一起。
 */

type AnyField = Record<string, unknown>

function walk(fields: unknown, visit: (node: AnyField) => void): void {
  if (!Array.isArray(fields)) return
  for (const raw of fields) {
    const node = raw as AnyField
    if (!node || typeof node !== 'object') continue
    visit(node)
    walk(node.fields, visit)
    walk(node.tabs, visit)
  }
}

const tabLabels = new Set<string>()
const fieldLabels = new Set<string>()
walk(Listings.fields, (node) => {
  if (Array.isArray(node.tabs)) {
    for (const raw of node.tabs) {
      const tab = raw as AnyField
      if (typeof tab.label === 'string') tabLabels.add(tab.label)
    }
  }
  if (typeof node.label === 'string') fieldLabels.add(node.label)
})

describe('listing-completeness-locate/映射完整', () => {
  it('每个提交必填键都有定位目标——漏一个就是一条点不动的提示', () => {
    expect(unmappedCompletenessKeys()).toEqual([])
  })

  it('租售两种口径的必填键都能取到目标', () => {
    for (const key of allLocatableCompletenessKeys()) {
      expect(locateForCompletenessField(key), `完整度键 ${key} 没有定位目标`).not.toBeNull()
    }
  })

  it('未登记的键返回 null，而不是抛错或给个错目标', () => {
    expect(locateForCompletenessField('不存在的字段')).toBeNull()
  })
})

describe('listing-completeness-locate/与 collection 配置一致', () => {
  it('每个 locateTab 都能对应到一个真实的 tab label', () => {
    expect(tabLabels.size).toBeGreaterThan(0)
    for (const [key, target] of Object.entries(LOCATE_FOR_KEY)) {
      expect(tabLabels, `${key} 的 locateTab「${target.locateTab}」不是真实 tab`).toContain(
        target.locateTab,
      )
    }
  })

  it('每个 locateFieldLabel 都能对应到一个真实的字段 label', () => {
    // locateFormField 用 startsWith 匹配 label 文本，字段改名而这里没跟上就滚不到目标
    for (const [key, target] of Object.entries(LOCATE_FOR_KEY)) {
      expect(
        fieldLabels,
        `${key} 的 locateFieldLabel「${target.locateFieldLabel}」不是真实字段 label`,
      ).toContain(target.locateFieldLabel)
    }
  })
})
