import { describe, expect, it } from 'vitest'

import { Media } from '@/collections/Media'
import { SKIPPED_SIZE_NAMES } from '@/plugins/watermark'

function imageSizes(): Array<{ name: string; width?: number; height?: number }> {
  const sizes = (Media.upload as { imageSizes?: Array<{ name: string; width?: number; height?: number }> })
    .imageSizes
  expect(sizes?.length).toBeGreaterThan(0)
  return sizes ?? []
}

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
    for (const size of imageSizes()) {
      expect(
        size.width !== undefined && size.height !== undefined,
        `imageSizes["${size.name}"] 同时声明了 width 和 height`,
      ).toBe(false)
    }
  })

  /**
   * `SKIPPED_SIZE_NAMES` 里写的是字面量 `'thumb'`，与这份配置之间没有任何编译期联系。
   * 把那一档改名（或删掉），插件那边不会有任何报错——只会**默默开始给 320px 图打角标**，
   * 正是 spec §4.5 判定不该发生的结果（9px 角标在缩略图上只是脏点）。
   */
  it('SKIPPED_SIZE_NAMES 的每一档都必须是真实存在的派生档名', () => {
    const names = imageSizes().map((size) => size.name)
    for (const skipped of SKIPPED_SIZE_NAMES) {
      expect(names, `SKIPPED_SIZE_NAMES 里的 "${skipped}" 在 imageSizes 里不存在`).toContain(skipped)
    }
  })

  it('被跳过的档必须比所有要打角标的档都小——否则等于把角标从大图上撤了', () => {
    const sizes = imageSizes()
    const widthOf = (name: string) => sizes.find((size) => size.name === name)?.width ?? 0
    const badged = sizes.filter((size) => !SKIPPED_SIZE_NAMES.has(size.name))
    expect(badged.length).toBeGreaterThan(0)
    for (const skipped of SKIPPED_SIZE_NAMES) {
      for (const size of badged) {
        expect(
          widthOf(skipped),
          `跳过的 "${skipped}" 不比要打角标的 "${size.name}" 小`,
        ).toBeLessThan(size.width ?? 0)
      }
    }
  })
})
