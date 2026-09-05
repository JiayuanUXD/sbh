import { readFileSync } from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { DEFAULT_WATERMARK_CONFIG } from '@/domain/media/watermark'
import {
  buildPreviewWatermarkConfig,
  readWatermarkSiteSettings,
  resolveWatermarkConfig,
} from '@/domain/media/watermark-settings'

/**
 * OPT-069 整支评审 Finding 3（Important）。
 *
 * 「读 site-settings → mergeWatermarkConfig(watermark, siteName)」此前抄了三份
 * （plugins/watermark.ts、domain/media/watermark-rebake.ts、scripts/backfill-watermark.ts），
 * 第四条路（/api/watermark-preview）已经分叉了：它传的是 `fallbackText = null`。
 *
 * 分叉的具体表现：SiteSettings 对文案字段写着「留空则回落为『站点名称』」，运营清空之后
 * **预览渲染的是 `商办荟`（DEFAULT 常量），烘焙渲染的是站点名称**——正是那个 tab 存在的
 * 唯一意义（所见即所得）被破坏。三处抄写就是它发生的原因。
 */
function fakePayload(global: unknown): { payload: Payload; calls: unknown[] } {
  const calls: unknown[] = []
  const payload = {
    findGlobal: async (args: unknown) => {
      calls.push(args)
      return global
    },
  } as unknown as Payload
  return { payload, calls }
}

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8')
}

describe('resolveWatermarkConfig', () => {
  it('读 site-settings（depth 0 / overrideAccess），把 siteName 当文案回落', async () => {
    const { payload, calls } = fakePayload({ watermark: { enabled: true }, siteName: '示例站点' })

    const config = await resolveWatermarkConfig(payload)

    expect(calls).toEqual([{ slug: 'site-settings', depth: 0, overrideAccess: true }])
    expect(config.enabled).toBe(true)
    expect(config.tiled.text).toBe('示例站点')
    expect(config.badge.text).toBe('示例站点')
  })

  it('全局从没保存过（各字段为 null）也不会让 null 覆盖缺省', async () => {
    const { payload } = fakePayload({ watermark: { enabled: null, tiled: { density: null, text: null } } })

    const config = await resolveWatermarkConfig(payload)

    expect(config.enabled).toBe(DEFAULT_WATERMARK_CONFIG.enabled)
    expect(config.tiled.density).toBe(DEFAULT_WATERMARK_CONFIG.tiled.density)
    expect(config.tiled.text).toBe(DEFAULT_WATERMARK_CONFIG.tiled.text)
  })

  it('readWatermarkSiteSettings 端出原始的 watermark / siteName，供预览端点取站点名', async () => {
    const { payload } = fakePayload({ watermark: { enabled: true }, siteName: '示例站点' })
    expect(await readWatermarkSiteSettings(payload)).toMatchObject({ siteName: '示例站点' })
  })
})

describe('预览与烘焙对「文案留空」必须给出同一个答案', () => {
  const SITE_NAME = '示例站点'
  /** 运营把两处文案都清空并保存后，站点设置里存着的就是空串。 */
  const STORED_WITH_CLEARED_TEXT = {
    watermark: { enabled: true, tiled: { text: '' }, badge: { text: '' } },
    siteName: SITE_NAME,
  }

  it('清空文案 → 两条路都回落成站点名称，而不是一边站点名称、一边默认常量', async () => {
    const { payload } = fakePayload(STORED_WITH_CLEARED_TEXT)
    const baked = await resolveWatermarkConfig(payload)

    // 预览端点拿到的是表单里的实时值：文案已清空 → 空串查询参数。
    const previewed = buildPreviewWatermarkConfig(
      new URLSearchParams({ text: '', density: String(baked.tiled.density) }),
      SITE_NAME,
    )

    expect(previewed.tiled.text).toBe(baked.tiled.text)
    expect(previewed.badge.text).toBe(baked.badge.text)
    expect(previewed.tiled.text).toBe(SITE_NAME)
  })

  it('文案没清空时预览用表单里的值，不被站点名称顶掉', () => {
    const previewed = buildPreviewWatermarkConfig(new URLSearchParams({ text: '临时文案' }), SITE_NAME)
    expect(previewed.tiled.text).toBe('临时文案')
    expect(previewed.badge.text).toBe('临时文案')
  })

  it('预览恒 enabled——它只是渲染样张，与总开关无关', () => {
    expect(buildPreviewWatermarkConfig(new URLSearchParams(), null).enabled).toBe(true)
  })

  it('超范围数值走 mergeWatermarkConfig 的夹取，与烘焙同一套规则', () => {
    const previewed = buildPreviewWatermarkConfig(
      new URLSearchParams({ density: '999', opacity: '5', angle: '900' }),
      null,
    )
    expect(previewed.tiled.density).toBe(6)
    expect(previewed.tiled.opacity).toBe(1)
    expect(previewed.tiled.angle).toBe(90)
  })
})

/**
 * 三条烘焙路径必须调同一个 `resolveWatermarkConfig`。只测行为拦不住「有人又抄一份」：
 * 抄出来的那份一开始必然与共享实现一致，测试照样全绿，漂移要几个月后才显形。
 */
describe('不许再出现第二份读取路径', () => {
  const bakePaths = [
    'src/plugins/watermark.ts',
    'src/domain/media/watermark-rebake.ts',
    'scripts/backfill-watermark.ts',
    'src/app/api/watermark-preview/route.ts',
  ]

  it('四条路都从 watermark-settings 取配置，自己不再调 findGlobal', () => {
    for (const relative of bakePaths) {
      const source = read(relative)
      expect(source, `${relative} 没有引用 watermark-settings`).toMatch(/watermark-settings/)
      expect(source, `${relative} 自己调了 findGlobal，等于又抄了一份读取路径`).not.toContain(
        'findGlobal(',
      )
    }
  })
})
