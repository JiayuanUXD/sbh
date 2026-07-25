import { describe, expect, it } from 'vitest'

import { protectDisplayTag } from '@/domain/dictionary/display-tag-protect'
import {
  DISPLAY_TAG_STATUSES,
  DISPLAY_TAG_STATUS_LABELS,
  isDisplayTagStatus,
  normalizeTagCode,
  snapshotTag,
} from '@/domain/dictionary/display-tag'

/**
 * M2.6 Part B 展示标签单测（Requirement R2）
 *
 * 覆盖纯函数（normalizeTagCode / snapshotTag / 状态守卫）与保护 hook
 * （code 不可改、版本乐观锁、停用允许）。protect hook 不读库，直接以
 * 内存 data/originalDoc 断言。
 */

const create = (data: Record<string, unknown>) =>
  protectDisplayTag({
    operation: 'create',
    originalDoc: undefined,
    data,
  } as never) as Promise<Record<string, unknown>>

const update = (data: Record<string, unknown>, originalDoc: Record<string, unknown>) =>
  protectDisplayTag({
    operation: 'update',
    originalDoc,
    data,
  } as never) as Promise<Record<string, unknown>>

describe('display-tag/normalizeTagCode', () => {
  it('去首尾空白后返回', () => {
    expect(normalizeTagCode('  hot_deal ')).toBe('hot_deal')
  })

  it('允许字母开头 + 大小写/数字/下划线/连字符', () => {
    expect(normalizeTagCode('New-Tag_2')).toBe('New-Tag_2')
  })

  it('非字符串 → INVALID_TAG_CODE', () => {
    expect(() => normalizeTagCode(123)).toThrowError(/INVALID_TAG_CODE|标签编码/)
  })

  it('数字开头 → 抛错', () => {
    expect(() => normalizeTagCode('2hot')).toThrow()
  })

  it('含非法字符 → 抛错', () => {
    expect(() => normalizeTagCode('hot deal')).toThrow()
    expect(() => normalizeTagCode('热门')).toThrow()
  })

  it('单字符（不足 2 位）→ 抛错', () => {
    expect(() => normalizeTagCode('a')).toThrow()
  })
})

describe('display-tag/snapshotTag', () => {
  it('冻结当时 code + name 为 label', () => {
    expect(snapshotTag({ code: 'hot', name: '热门推荐' })).toEqual({
      code: 'hot',
      label: '热门推荐',
    })
  })
})

describe('display-tag/状态枚举', () => {
  it('每个状态都有中文 label', () => {
    for (const s of DISPLAY_TAG_STATUSES) {
      expect(DISPLAY_TAG_STATUS_LABELS[s].trim().length).toBeGreaterThan(0)
    }
  })

  it('isDisplayTagStatus 守卫', () => {
    expect(isDisplayTagStatus('active')).toBe(true)
    expect(isDisplayTagStatus('disabled')).toBe(true)
    expect(isDisplayTagStatus('nope')).toBe(false)
    expect(isDisplayTagStatus(1)).toBe(false)
  })
})

describe('display-tag-protect/create', () => {
  it('合法 code → 通过并设 version=1，回写规范化 code', async () => {
    const out = await create({ code: '  featured ', name: '精选' })
    expect(out.code).toBe('featured')
    expect(out.version).toBe(1)
  })

  it('非法 code → 抛错', async () => {
    await expect(create({ code: '1bad', name: 'x' })).rejects.toThrow()
  })
})

describe('display-tag-protect/update', () => {
  it('改 code → TAG_CODE_IMMUTABLE', async () => {
    await expect(
      update({ code: 'renamed', name: '精选', version: 1 }, { code: 'featured', version: 1 }),
    ).rejects.toMatchObject({ code: 'TAG_CODE_IMMUTABLE' })
  })

  it('只改 name（code 不变）→ 通过，版本自增', async () => {
    const out = await update(
      { code: 'featured', name: '超级精选', version: 3 },
      { code: 'featured', name: '精选', version: 3 },
    )
    expect(out.version).toBe(4)
    expect(out.name).toBe('超级精选')
  })

  it('版本不匹配 → VERSION_CONFLICT', async () => {
    await expect(
      update({ code: 'featured', version: 2 }, { code: 'featured', version: 5 }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('停用（status=disabled）→ 允许保存', async () => {
    const out = await update(
      { code: 'featured', status: 'disabled', version: 1 },
      { code: 'featured', status: 'active', version: 1 },
    )
    expect(out.status).toBe('disabled')
    expect(out.version).toBe(2)
  })
})
