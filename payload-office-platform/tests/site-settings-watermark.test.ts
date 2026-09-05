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

    const badge = fieldByName(groupFields, 'badge') as AnyField
    const badgeFields = badge.fields as AnyField[]
    expect(fieldByName(badgeFields, 'position')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.badge.position)
    expect(fieldByName(badgeFields, 'opacity')?.defaultValue).toBe(DEFAULT_WATERMARK_CONFIG.badge.opacity)
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
