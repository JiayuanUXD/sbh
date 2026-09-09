import { describe, expect, it } from 'vitest'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'
import { BUILDING_SPEC_FIELDS, LISTING_SPEC_FIELDS } from '@/lib/frontend/detail-spec/fields'

/**
 * OPT-082 三层兜底的第三层。
 *
 * `site_settings` 表在迁移执行前不存在，构建期预渲染与迁移前的渲染都会走
 * `SITE_SETTINGS_FALLBACK`（`readSiteSettings` 的 catch 分支）。此时前台必须仍是
 * 改造前的现状——「上线零变化」不只是「默认值填对了」，还包括「表还没建好的那段
 * 时间里也不变」。OPT-053 正是靠这一层才能把内容配置分两次发布。
 */
describe('SITE_SETTINGS_FALLBACK.detailSpecFields', () => {
  it('楼盘侧兜底逐项等于 registry 默认', () => {
    for (const field of BUILDING_SPEC_FIELDS) {
      expect(
        SITE_SETTINGS_FALLBACK.detailSpecFields.building[field.key],
        `building.${field.key}`,
      ).toBe(field.defaultVisible)
    }
  })

  it('房源侧兜底逐项等于 registry 默认', () => {
    for (const field of LISTING_SPEC_FIELDS) {
      expect(
        SITE_SETTINGS_FALLBACK.detailSpecFields.listing[field.key],
        `listing.${field.key}`,
      ).toBe(field.defaultVisible)
    }
  })

  it('兜底里没有 registry 之外的孤儿键', () => {
    expect(Object.keys(SITE_SETTINGS_FALLBACK.detailSpecFields.building).sort()).toEqual(
      BUILDING_SPEC_FIELDS.map((field) => field.key).sort(),
    )
    expect(Object.keys(SITE_SETTINGS_FALLBACK.detailSpecFields.listing).sort()).toEqual(
      LISTING_SPEC_FIELDS.map((field) => field.key).sort(),
    )
  })
})
