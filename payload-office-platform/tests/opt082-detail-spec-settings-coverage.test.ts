import { describe, expect, it } from 'vitest'
import { SiteSettings } from '@/globals/SiteSettings'
import { BUILDING_SPEC_FIELDS, LISTING_SPEC_FIELDS } from '@/lib/frontend/detail-spec/fields'

/**
 * OPT-082：registry ↔ SiteSettings 字段的一一对应守卫。
 *
 * 47 个 checkbox 由 registry 生成而不是手抄（见 `site-settings-spec-fields.ts`
 * 文件头）。这份用例盯的是「生成器有没有真的把每一项都生成出来」——生成器写错
 * 一个 filter 条件，后果是某几项在后台根本不出现，运营以为那些字段不可配、
 * 而前台却按 registry 默认照常展示，两边说法不一致且没有任何报错。
 */

type AnyField = Record<string, unknown>

function collectCheckboxes(fields: readonly unknown[]): AnyField[] {
  const out: AnyField[] = []
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue
    const field = raw as AnyField
    if (field.type === 'checkbox' && typeof field.name === 'string') out.push(field)
    if (Array.isArray(field.fields)) out.push(...collectCheckboxes(field.fields))
    if (Array.isArray(field.tabs)) {
      for (const tab of field.tabs) {
        const tabFields = (tab as AnyField)?.fields
        if (Array.isArray(tabFields)) out.push(...collectCheckboxes(tabFields))
      }
    }
  }
  return out
}

function sideFields(side: 'building' | 'listing'): unknown[] {
  const tabsField = (SiteSettings.fields as AnyField[]).find((field) => field.type === 'tabs')
  const tabs = (tabsField?.tabs ?? []) as AnyField[]
  const tab = tabs.find((item) => item.label === '详情页参数')
  const root = ((tab?.fields ?? []) as AnyField[]).find((f) => f.name === 'detailSpecFields')
  const sideGroup = ((root?.fields ?? []) as AnyField[]).find((f) => f.name === side)
  return (sideGroup?.fields ?? []) as unknown[]
}

describe('registry ↔ SiteSettings 覆盖守卫', () => {
  it('楼盘 23 项全部生成了同名 checkbox，无孤儿、无遗漏', () => {
    const names = collectCheckboxes(sideFields('building')).map((f) => f.name as string)
    expect(names.sort()).toEqual(BUILDING_SPEC_FIELDS.map((f) => f.key).sort())
  })

  it('房源 24 项全部生成了同名 checkbox，无孤儿、无遗漏', () => {
    const names = collectCheckboxes(sideFields('listing')).map((f) => f.name as string)
    expect(names.sort()).toEqual(LISTING_SPEC_FIELDS.map((f) => f.key).sort())
  })

  it('每个 checkbox 的 defaultValue 等于 registry 的 defaultVisible（上线零变化的一半）', () => {
    for (const [side, defs] of [
      ['building', BUILDING_SPEC_FIELDS],
      ['listing', LISTING_SPEC_FIELDS],
    ] as const) {
      const boxes = collectCheckboxes(sideFields(side))
      for (const def of defs) {
        const box = boxes.find((f) => f.name === def.key)
        expect(box, `${side}.${def.key} 没有生成 checkbox`).toBeDefined()
        expect(box?.defaultValue, `${side}.${def.key} 的默认值与 registry 不符`).toBe(
          def.defaultVisible,
        )
      }
    }
  })

  it('checkbox 的 label 取自 registry，后台与前台是同一套叫法', () => {
    const boxes = collectCheckboxes(sideFields('building'))
    for (const def of BUILDING_SPEC_FIELDS) {
      expect(boxes.find((f) => f.name === def.key)?.label).toBe(def.label)
    }
  })
})
