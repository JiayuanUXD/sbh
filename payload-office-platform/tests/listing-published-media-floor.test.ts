/**
 * 已上架房源媒体地板校验（C 项：把静默下架变成显式拦截）
 *
 * 背景：`syncListingMedia` 把 gallery 改为从 mediaItems 派生，且只取 kind='image'。
 * 已上架房源经媒体工作台保存后若图片不足 MIN_SUBMIT_MEDIA 张，
 * 有效供给精筛 §6（listings_gallery COUNT >= 3）会把它从前台全量撤下，
 * 而审核提交门此时早已通过、不再复跑 → 运营侧毫无提示的「静默下架」。
 *
 * 本文件锁定纯函数判定；hook 层的抛错在 listing-media-sync.test.ts 覆盖。
 */

import { describe, expect, it } from 'vitest'

import {
  MIN_SUBMIT_MEDIA,
  violatesPublishedMediaFloor,
} from '@/domain/review/listing-completeness'

describe('violatesPublishedMediaFloor（已上架媒体地板）', () => {
  it('已上架 + 图片不足 MIN_SUBMIT_MEDIA → 违规', () => {
    expect(
      violatesPublishedMediaFloor({ publicationStatus: 'published', galleryCount: 2 }),
    ).toBe(true)
    expect(
      violatesPublishedMediaFloor({ publicationStatus: 'published', galleryCount: 0 }),
    ).toBe(true)
  })

  it('已上架 + 图片刚好达标 → 放行（边界）', () => {
    expect(
      violatesPublishedMediaFloor({
        publicationStatus: 'published',
        galleryCount: MIN_SUBMIT_MEDIA,
      }),
    ).toBe(false)
  })

  it('未上架的三种状态即使图片为 0 也放行——草稿期允许边攒边存', () => {
    for (const status of ['draft', 'unpublished', 'leased']) {
      expect(violatesPublishedMediaFloor({ publicationStatus: status, galleryCount: 0 })).toBe(
        false,
      )
    }
  })

  it('发布状态缺失 / 非法值按未上架处理，不误伤', () => {
    expect(violatesPublishedMediaFloor({ galleryCount: 0 })).toBe(false)
    expect(violatesPublishedMediaFloor({ publicationStatus: null, galleryCount: 0 })).toBe(false)
    expect(violatesPublishedMediaFloor({ publicationStatus: 42, galleryCount: 0 })).toBe(false)
  })
})
