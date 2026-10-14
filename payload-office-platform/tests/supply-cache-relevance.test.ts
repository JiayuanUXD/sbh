/**
 * OPT-111：供给写入能否影响公开页面的判定。
 *
 * 判定错成「跳过」的代价是该变化最长 300s（TTL）后才对外可见；错成「失效」只是
 * 多清一次缓存。所以每条规则在拿不准时都偏向失效，下面的用例同时钉住两个方向。
 * 已获用户确认的行为变化（2026-10-14，D1）：只改内部字段不再清缓存，
 * 连带按 `updatedAt` 的排序位置要等 TTL 后才前移。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  INTERNAL_ONLY_SUPPLY_FIELDS,
  decideSupplyCacheInvalidation,
  type SupplyCollection,
} from '@/domain/public-catalog/supply-cache-relevance'

function change(collection: SupplyCollection, previousDoc: unknown, doc: unknown) {
  return decideSupplyCacheInvalidation({ collection, previousDoc, doc, operation: 'change' })
}

const PUBLISHED_LISTING = { id: 11, publicationStatus: 'published', rent: 1, building: 5 }

describe('decideSupplyCacheInvalidation：房源', () => {
  it('draft-to-draft：前后都是草稿 → 跳过', () => {
    expect(change('listings', { publicationStatus: 'draft', rent: 1 }, { publicationStatus: 'draft', rent: 2 }))
      .toEqual({ invalidate: false, reason: 'never_public' })
  })

  it('publish：草稿 → 已上架 → 失效', () => {
    expect(change('listings', { ...PUBLISHED_LISTING, publicationStatus: 'draft' }, PUBLISHED_LISTING))
      .toEqual({ invalidate: true, reason: 'became_or_was_public' })
  })

  it('unpublish：已上架 → 已下架 → 失效', () => {
    expect(change('listings', PUBLISHED_LISTING, { ...PUBLISHED_LISTING, publicationStatus: 'unpublished' }))
      .toEqual({ invalidate: true, reason: 'became_or_was_public' })
  })

  it('public-field：已上架改租金 → 失效', () => {
    expect(change('listings', PUBLISHED_LISTING, { ...PUBLISHED_LISTING, rent: 2 }))
      .toEqual({ invalidate: true, reason: 'public_field_changed' })
  })

  it('internal-only：已上架只改房号与元字段 → 跳过', () => {
    expect(change(
      'listings',
      { ...PUBLISHED_LISTING, roomNumber: '1201', updatedAt: '2026-10-01', version: 3 },
      { ...PUBLISHED_LISTING, roomNumber: '1202', updatedAt: '2026-10-14', version: 4 },
    )).toEqual({ invalidate: false, reason: 'internal_fields_only' })
  })

  it('soft-delete：已上架且置 deletedAt → 失效', () => {
    expect(change('listings', PUBLISHED_LISTING, { ...PUBLISHED_LISTING, deletedAt: '2026-10-14T00:00:00Z' }))
      .toEqual({ invalidate: true, reason: 'public_field_changed' })
  })

  it('building-change：换楼盘 → 失效', () => {
    expect(change('listings', PUBLISHED_LISTING, { ...PUBLISHED_LISTING, building: 6 }).invalidate).toBe(true)
  })

  it('populated-vs-id：裸 {id} 对象认不出是展开文档 → 失效（安全方向）', () => {
    expect(change('listings', PUBLISHED_LISTING, { ...PUBLISHED_LISTING, building: { id: 5 } }).invalidate).toBe(true)
  })

  /**
   * 以下形状取自真实 Payload afterChange（2026-10-14 本地实测，OPT-111 Task 4 排查）：
   *   - previousDoc 恒为 depth 0；doc 随调用方 depth（Local API 默认 defaultDepth=2）展开关系；
   *   - Listings 的 beforeChange 每次保存都由 mediaItems 重建 gallery，数组行 id 每次都换。
   * 不归一化的话，只改房号的保存也会被判成公开变化。
   */
  const populated = (id: number, extra: Record<string, unknown> = {}) => ({
    id, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', ...extra,
  })

  it('gallery-rows-rebuilt：图片相同、行 id 重建，只改房号 → 跳过', () => {
    expect(change(
      'listings',
      { ...PUBLISHED_LISTING, roomNumber: '1201', gallery: [{ id: '6acf2741eb01342cd3787bbb', image: 8 }, { id: '6acf2741eb01342cd3787bbc', image: 9 }] },
      { ...PUBLISHED_LISTING, roomNumber: '1202', gallery: [{ id: '6acf2783a726c42e8db862c3', image: 8 }, { id: '6acf2783a726c42e8db862c4', image: 9 }] },
    )).toEqual({ invalidate: false, reason: 'internal_fields_only' })
  })

  it('gallery-image-changed：换了一张图 → 失效', () => {
    expect(change(
      'listings',
      { ...PUBLISHED_LISTING, gallery: [{ id: 'a', image: 8 }] },
      { ...PUBLISHED_LISTING, gallery: [{ id: 'b', image: 9 }] },
    )).toEqual({ invalidate: true, reason: 'public_field_changed' })
  })

  it('gallery-reordered：调换图片顺序 → 失效', () => {
    expect(change(
      'listings',
      { ...PUBLISHED_LISTING, gallery: [{ id: 'a', image: 8 }, { id: 'b', image: 9 }] },
      { ...PUBLISHED_LISTING, gallery: [{ id: 'c', image: 9 }, { id: 'd', image: 8 }] },
    )).toEqual({ invalidate: true, reason: 'public_field_changed' })
  })

  it('default-depth：doc 展开了关系、previousDoc 是 id，只改房号 → 跳过', () => {
    expect(change(
      'listings',
      { ...PUBLISHED_LISTING, roomNumber: '1201', building: 1, merchant: 1, coverImage: 3, gallery: [{ id: 'a', image: 8 }] },
      {
        ...PUBLISHED_LISTING,
        roomNumber: '1202',
        building: populated(1, { name: '南京西路高端商务中心', city: populated(1, { slug: 'shanghai' }) }),
        merchant: populated(1, { name: '静安置业（业主）' }),
        coverImage: populated(3, { alt: '外景', prefix: 'media' }),
        gallery: [{ id: 'b', image: populated(8, { alt: '开放式办公区' }) }],
      },
    )).toEqual({ invalidate: false, reason: 'internal_fields_only' })
  })

  it('default-depth：展开后的楼盘换成另一个 → 失效', () => {
    expect(change('listings', { ...PUBLISHED_LISTING, building: 5 }, { ...PUBLISHED_LISTING, building: populated(6) }))
      .toEqual({ invalidate: true, reason: 'public_field_changed' })
  })

  it('missing-status-changed：两侧都缺状态字段且改了租金 → 失效', () => {
    expect(change('listings', { rent: 1 }, { rent: 2 }))
      .toEqual({ invalidate: true, reason: 'public_field_changed' })
  })

  it('no-op-save：已上架只有 updatedAt / version 变 → 跳过', () => {
    expect(change(
      'listings',
      { ...PUBLISHED_LISTING, updatedAt: '2026-10-01', version: 3 },
      { ...PUBLISHED_LISTING, updatedAt: '2026-10-14', version: 4 },
    )).toEqual({ invalidate: false, reason: 'internal_fields_only' })
  })

  it('unknown-shape：一侧不是对象 → 失效', () => {
    expect(change('listings', null, PUBLISHED_LISTING))
      .toEqual({ invalidate: true, reason: 'unknown_shape' })
  })
})

describe('decideSupplyCacheInvalidation：楼盘', () => {
  it('create-draft：新建草稿 → 跳过', () => {
    expect(decideSupplyCacheInvalidation({ collection: 'buildings', doc: { status: 'draft' }, operation: 'change' }))
      .toEqual({ invalidate: false, reason: 'never_public' })
  })

  it('create-published：新建即发布 → 失效', () => {
    expect(decideSupplyCacheInvalidation({ collection: 'buildings', doc: { status: 'published' }, operation: 'change' }))
      .toEqual({ invalidate: true, reason: 'created_public' })
  })

  it('delete-draft：删除草稿 → 跳过', () => {
    expect(decideSupplyCacheInvalidation({ collection: 'buildings', doc: { status: 'draft' }, operation: 'delete' }))
      .toEqual({ invalidate: false, reason: 'never_public' })
  })

  it('delete-published：删除已发布 → 失效', () => {
    expect(decideSupplyCacheInvalidation({ collection: 'buildings', doc: { status: 'published' }, operation: 'delete' }))
      .toEqual({ invalidate: true, reason: 'deleted_public' })
  })

  it('building-internal-only：已发布只改核验状态 → 跳过', () => {
    expect(change(
      'buildings',
      { id: 5, status: 'published', name: 'A', verificationStatus: 'pending' },
      { id: 5, status: 'published', name: 'A', verificationStatus: 'verified' },
    )).toEqual({ invalidate: false, reason: 'internal_fields_only' })
  })

  it('房源的状态字段对楼盘不算数：楼盘缺 status 而有 publicationStatus → 视为可能公开', () => {
    expect(change('buildings', { publicationStatus: 'draft', name: 'A' }, { publicationStatus: 'draft', name: 'B' }).invalidate)
      .toBe(true)
  })
})

/**
 * 名单里的字段一旦出现在公开代码里，就不再是「内部字段」——跳过它的变化会让前台
 * 陈旧最长 300s。元字段（updatedAt / createdAt / version）已知被公开排序使用，
 * 是 D1 明确接受的代价，不在扫描之列。
 */
describe('内部字段名单的源码契约', () => {
  const APP_ROOT = path.resolve(__dirname, '..')
  const PUBLIC_DIRS = [
    'src/domain/public-catalog',
    'src/lib/frontend',
    'src/app/(frontend)',
    'src/components/frontend',
    'src/lib/mini-program',
    'src/domain/mini-program',
    'src/app/api/mini',
  ]
  const META_FIELDS = new Set(['updatedAt', 'createdAt', 'version'])
  // 本文件自己的名单定义不算公开引用
  const SELF = path.join(APP_ROOT, 'src/domain/public-catalog/supply-cache-relevance.ts')

  function sourceFiles(dir: string): string[] {
    const abs = path.join(APP_ROOT, dir)
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      return []
    }
    return entries.flatMap((name) => {
      const full = path.join(abs, name)
      if (statSync(full).isDirectory()) return sourceFiles(path.join(dir, name))
      return /\.(ts|tsx)$/.test(name) && full !== SELF ? [full] : []
    })
  }

  it('内部字段在公开代码中零引用', () => {
    const files = PUBLIC_DIRS.flatMap(sourceFiles)
    expect(files.length).toBeGreaterThan(50)
    const fields = [...new Set(Object.values(INTERNAL_ONLY_SUPPLY_FIELDS).flat())]
      .filter((field) => !META_FIELDS.has(field))
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const field of fields) {
        if (new RegExp(`\\b${field}\\b`).test(text)) hits.push(`${field} @ ${path.relative(APP_ROOT, file)}`)
      }
    }
    expect(hits).toEqual([])
  })
})
