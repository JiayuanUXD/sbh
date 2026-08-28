import { describe, expect, it } from 'vitest'

import { CitySiteProfiles } from '@/collections/CitySiteProfiles'
import { SiteSettings } from '@/globals/SiteSettings'
import { SLOT_TARGETS } from '@/components/frontend/home/HomeTypeCards'

/**
 * 回归（最终审查 B）：槽位字符串必须在三处逐字一致——
 *   - `SiteSettings.ts` 的 `typeCards[].slot` 的 `options`；
 *   - `CitySiteProfiles.ts` 的 `typeCardOverrides[].slot` 的 `options`；
 *   - `HomeTypeCards.tsx` 的 `SLOT_TARGETS` 的键。
 *
 * 变异测试证实：把 `CitySiteProfiles` 那处的 `{ value: 'coworking' }` 改成
 * `'co-working'`，全量 3916 个用例零红——两个 collection/global 之间的 options
 * 没有任何机器守卫在盯。（改 `SLOT_TARGETS` 的键会让 `city-home-view.test.ts`
 * 两条精确变红，所以缺口只在两个 collection 的 options 之间。）
 *
 * 失败场景：将来新增或重命名槽位时只改了两处 → 运营在城市配置里能选到
 * 该槽位、存盘 200、前台完全不生效，页面上看不出任何异常。
 *
 * 三份槽位值都从**真实的 collection / global 配置对象**里取，不在测试里
 * 再抄一遍字符串——抄一遍就是第四处，反而多一个漂移点。
 */

type ConfigField = Readonly<{
  name?: string
  fields?: readonly ConfigField[]
  tabs?: readonly { fields?: readonly ConfigField[] }[]
  options?: readonly { value: string }[]
}>

/** 深度优先遍历 Payload field 树（含 tabs 包裹），按 name 找字段。 */
function findField(fields: readonly ConfigField[], name: string): ConfigField | null {
  const stack: ConfigField[] = [...fields]
  while (stack.length > 0) {
    const f = stack.pop()
    if (!f || typeof f !== 'object') continue
    if (f.name === name) return f
    if (Array.isArray(f.fields)) stack.push(...f.fields)
    if (Array.isArray(f.tabs)) {
      for (const tab of f.tabs) {
        if (Array.isArray(tab.fields)) stack.push(...tab.fields)
      }
    }
  }
  return null
}

/** 找到 `<arrayFieldName>[].slot` 这个 select 字段的 options 取值集合。 */
function slotOptionValues(rootFields: readonly ConfigField[], arrayFieldName: string): Set<string> {
  const arrayField = findField(rootFields, arrayFieldName)
  if (!arrayField) throw new Error(`找不到字段 ${arrayFieldName}`)
  const slotField = (arrayField.fields ?? []).find((f) => f.name === 'slot')
  if (!slotField) throw new Error(`${arrayFieldName} 下找不到 slot 子字段`)
  const options = slotField.options ?? []
  return new Set(options.map((o) => o.value))
}

/** 两个集合的对称差，用于断言失败时报出「哪一处多了/少了哪个槽位」。 */
function diffSets(a: Set<string>, b: Set<string>) {
  const onlyInA = [...a].filter((v) => !b.has(v))
  const onlyInB = [...b].filter((v) => !a.has(v))
  return { onlyInA, onlyInB }
}

describe('槽位字符串三处一致（SiteSettings / CitySiteProfiles / SLOT_TARGETS）', () => {
  it('SiteSettings.typeCards[].slot 的 options 与 SLOT_TARGETS 的键一致', () => {
    const globalSlots = slotOptionValues(SiteSettings.fields as ConfigField[], 'typeCards')
    const targetSlots = new Set(Object.keys(SLOT_TARGETS))
    const { onlyInA, onlyInB } = diffSets(globalSlots, targetSlots)
    expect(
      { onlyInSiteSettings: onlyInA, onlyInSlotTargets: onlyInB },
    ).toEqual({ onlyInSiteSettings: [], onlyInSlotTargets: [] })
  })

  it('CitySiteProfiles.typeCardOverrides[].slot 的 options 与 SLOT_TARGETS 的键一致', () => {
    const profileSlots = slotOptionValues(CitySiteProfiles.fields as ConfigField[], 'typeCardOverrides')
    const targetSlots = new Set(Object.keys(SLOT_TARGETS))
    const { onlyInA, onlyInB } = diffSets(profileSlots, targetSlots)
    expect(
      { onlyInCitySiteProfiles: onlyInA, onlyInSlotTargets: onlyInB },
    ).toEqual({ onlyInCitySiteProfiles: [], onlyInSlotTargets: [] })
  })

  it('SiteSettings.typeCards 与 CitySiteProfiles.typeCardOverrides 的 options 互相一致', () => {
    const globalSlots = slotOptionValues(SiteSettings.fields as ConfigField[], 'typeCards')
    const profileSlots = slotOptionValues(CitySiteProfiles.fields as ConfigField[], 'typeCardOverrides')
    const { onlyInA, onlyInB } = diffSets(globalSlots, profileSlots)
    expect(
      { onlyInSiteSettings: onlyInA, onlyInCitySiteProfiles: onlyInB },
    ).toEqual({ onlyInSiteSettings: [], onlyInCitySiteProfiles: [] })
  })
})
