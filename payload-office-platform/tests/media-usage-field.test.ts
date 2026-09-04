import { describe, expect, it } from 'vitest'

import { Media } from '@/collections/Media'

function findField(name: string) {
  return Media.fields.find((field) => 'name' in field && field.name === name)
}

describe('Media.usage', () => {
  it('存在且是 select', () => {
    const field = findField('usage') as { type: string } | undefined
    expect(field?.type).toBe('select')
  })

  it('默认值是 listing-photo——误打可逆、漏打不可逆，默认要偏向可恢复的一侧', () => {
    const field = findField('usage') as { defaultValue?: string } | undefined
    expect(field?.defaultValue).toBe('listing-photo')
  })

  it('默认值必须在 options 里（PG 的 ENUM 校验比 SQLite 严，不在选项内会被拒绝插入）', () => {
    const field = findField('usage') as
      | { defaultValue?: string; options?: Array<{ value: string }> }
      | undefined
    const values = field?.options?.map((option) => option.value) ?? []
    expect(values).toContain(field?.defaultValue)
    expect(values).toEqual(
      expect.arrayContaining(['listing-photo', 'brand', 'article', 'other']),
    )
  })
})

describe('Media.watermark', () => {
  it('是只读 group，含 version 与 appliedAt', () => {
    const field = findField('watermark') as
      | { type: string; admin?: { readOnly?: boolean }; fields?: Array<{ name: string }> }
      | undefined
    expect(field?.type).toBe('group')
    expect(field?.admin?.readOnly).toBe(true)
    expect(field?.fields?.map((sub) => sub.name)).toEqual(
      expect.arrayContaining(['version', 'appliedAt']),
    )
  })
})

describe('Media.upload.imageSizes 守卫', () => {
  it('任何一档都不得同时声明 width 和 height', () => {
    // 同时声明会走 createImageSizes 的 resizeWithFocalPoint 真裁切分支，
    // 右下角标可能被裁掉（spec §9 守卫 1）。
    const sizes = (Media.upload as { imageSizes?: Array<{ name: string; width?: number; height?: number }> })
      .imageSizes
    expect(sizes?.length).toBeGreaterThan(0)
    for (const size of sizes ?? []) {
      expect(
        size.width !== undefined && size.height !== undefined,
        `imageSizes["${size.name}"] 同时声明了 width 和 height`,
      ).toBe(false)
    }
  })
})
