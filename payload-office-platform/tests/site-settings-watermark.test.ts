import { describe, expect, it } from 'vitest'

import { DEFAULT_WATERMARK_CONFIG } from '@/domain/media/watermark'
import { SiteSettings } from '@/globals/SiteSettings'

type AnyField = Record<string, unknown>

function tabs(): AnyField[] {
  const tabsField = SiteSettings.fields.find((field) => (field as AnyField).type === 'tabs') as AnyField
  return (tabsField.tabs as AnyField[]) ?? []
}

function watermarkTab(): AnyField {
  const tab = tabs().find((item) => item.label === '图片水印')
  expect(tab, 'SiteSettings 缺少「图片水印」tab').toBeDefined()
  return tab as AnyField
}

function fieldByName(fields: AnyField[], name: string): AnyField | undefined {
  return fields.find((field) => field.name === name)
}

describe('SiteSettings 图片水印 tab', () => {
  it('存在，且顶层是 watermark group', () => {
    const fields = watermarkTab().fields as AnyField[]
    expect(fieldByName(fields, 'watermark')?.type).toBe('group')
  })

  it('默认值与代码常量一致——两处不一致会让「没改过配置」的站点行为漂移', () => {
    const group = fieldByName(watermarkTab().fields as AnyField[], 'watermark') as AnyField
    const groupFields = group.fields as AnyField[]
    expect(fieldByName(groupFields, 'enabled')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.enabled)

    const tiled = fieldByName(groupFields, 'tiled') as AnyField
    const tiledFields = tiled.fields as AnyField[]
    expect(fieldByName(tiledFields, 'density')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.tiled.density)
    expect(fieldByName(tiledFields, 'opacity')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.tiled.opacity)
    expect(fieldByName(tiledFields, 'angle')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.tiled.angle)
    expect(fieldByName(tiledFields, 'source')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.tiled.source)
    expect(fieldByName(tiledFields, 'imageScale')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.tiled.imageScale)

    const badge = fieldByName(groupFields, 'badge') as AnyField
    const badgeFields = badge.fields as AnyField[]
    expect(fieldByName(badgeFields, 'position')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.badge.position)
    expect(fieldByName(badgeFields, 'opacity')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.badge.opacity)
    expect(fieldByName(badgeFields, 'source')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.badge.source)
    expect(fieldByName(badgeFields, 'imageScale')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.badge.imageScale)
  })

  /**
   * OPT-071：水印图片字段**必须可空**。required 的 upload 字段会生成 NOT NULL +
   * ON DELETE SET NULL，被引用的 media 从此删不掉——OPT-070 为这个死结把四列收口过
   * （见 domain/media/media-delete-cleanup.ts）。谁以后加个 required 想「保证选了图」，
   * 这条会红，并把代价摆在他面前。
   */
  it('水印图片字段可空——required 的 upload 会造成删不掉 media 的死结', () => {
    const group = fieldByName(watermarkTab().fields as AnyField[], 'watermark') as AnyField
    const groupFields = group.fields as AnyField[]
    for (const layout of ['tiled', 'badge']) {
      const layoutFields = (fieldByName(groupFields, layout) as AnyField).fields as AnyField[]
      const image = fieldByName(layoutFields, 'image') as AnyField
      expect(image, `${layout} 缺 image 字段`).toBeTruthy()
      expect(image.type).toBe('upload')
      expect((image as { relationTo?: string }).relationTo).toBe('media')
      expect((image as { required?: boolean }).required).toBeFalsy()
    }
  })

  it('source 的默认值在 options 里（PG ENUM 严格校验）', () => {
    const group = fieldByName(watermarkTab().fields as AnyField[], 'watermark') as AnyField
    const groupFields = group.fields as AnyField[]
    for (const layout of ['tiled', 'badge'] as const) {
      const layoutFields = (fieldByName(groupFields, layout) as AnyField).fields as AnyField[]
      const source = fieldByName(layoutFields, 'source') as AnyField & {
        options?: Array<{ value: string }>
        defaultValue?: string
      }
      const values = (source.options ?? []).map((o) => o.value)
      expect(values).toContain(source.defaultValue)
      expect(values).toEqual(['text', 'image'])
    }
  })

  it('position 的默认值在 options 里（PG ENUM 严格校验）', () => {
    const group = fieldByName(watermarkTab().fields as AnyField[], 'watermark') as AnyField
    const badge = fieldByName(group.fields as AnyField[], 'badge') as AnyField
    const position = fieldByName(badge.fields as AnyField[], 'position') as AnyField
    const values = (position.options as Array<{ value: string }>).map((option) => option.value)
    expect(values).toContain(position.defaultValue)
  })

  it('挂了只读预览组件——运营改完要能立刻看到效果', () => {
    const fields = watermarkTab().fields as AnyField[]
    const preview = fields.find((field) => field.type === 'ui') as AnyField | undefined
    const components = (preview?.admin as AnyField | undefined)?.components as AnyField | undefined
    expect(components?.Field).toBe('/components/admin/WatermarkPreview')
  })

  it('说明文案必须点破「保存不追溯生效」——否则运营会以为改完全站就变了', () => {
    const group = fieldByName(watermarkTab().fields as AnyField[], 'watermark') as AnyField
    const description = String((group.admin as AnyField | undefined)?.description ?? '')
    expect(description).toMatch(/重刷/)
  })

  it('挂了重刷按钮——没有它，上面那组参数就是一个「改了没反应」的旋钮', () => {
    const fields = watermarkTab().fields as AnyField[]
    const uiFields = fields.filter((field) => field.type === 'ui')
    const paths = uiFields.map(
      (field) => ((field.admin as AnyField).components as AnyField).Field,
    )
    expect(paths).toContain('/components/admin/WatermarkPreview')
    expect(paths).toContain('/components/admin/WatermarkRebakeButton')
  })
})
