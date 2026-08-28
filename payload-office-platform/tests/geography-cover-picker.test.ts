import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadCoverMedia } from '@/components/admin/geography/CoverPickerModal'

const SRC = readFileSync('src/components/admin/geography/CoverPickerModal.tsx', 'utf8')

/**
 * OPT-062：选图/上传弹层。
 *
 * 源码字符串断言只用来守「这是客户端组件」「不 import Payload 表单 UI」这类
 * 结构性约束；「上传失败必须报错」这类行为性约束改走真实行为测试
 * （mock `global.fetch` 调 `uploadCoverMedia`），因为字符串匹配防不住
 * 「判断逻辑被删掉但字符串还留着」——第一版的 `res\.ok` 裸匹配就踩过这个坑：
 * `loadMedia`（素材库列表加载）里也有一份 `res.ok`，删掉上传路径里的判断后
 * 那条断言仍然全绿。重交互（弹层开关、ESC 冒泡、强刷回显）留给浏览器验收。
 */
describe('CoverPickerModal 的结构性约束', () => {
  it('是客户端组件', () => {
    expect(SRC.startsWith("'use client'")).toBe(true)
  })

  it('不从 Payload UI 引入任何东西（抽屉在 Payload 表单之外）', () => {
    // 只锁 import 语句：说明性注释里解释「为什么不能用 useField/useForm」
    // 不该让这条测试变红——它锁的是「有没有真的 import」，不是「提没提过这个词」。
    expect(SRC).not.toMatch(/from\s+['"]@payloadcms\/ui['"]/)
  })
})

describe('uploadCoverMedia 的真实行为', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const makeFile = () => new File(['fake-bytes'], 'cover.jpg', { type: 'image/jpeg' })

  it('非 2xx（413）必须 throw，且错误信息带 HTTP 状态码', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({}),
    }) as unknown as typeof fetch

    await expect(uploadCoverMedia(makeFile(), '陆家嘴商圈封面')).rejects.toThrow(/413/)
  })

  it('非 2xx（403，换一个状态码确认不是写死的）必须 throw，且错误信息带该状态码', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    }) as unknown as typeof fetch

    await expect(uploadCoverMedia(makeFile(), '陆家嘴商圈封面')).rejects.toThrow(/403/)
  })

  it('成功时返回 { id, url }，且发出的 FormData 里 _payload 带上了传入的 alt', async () => {
    let capturedBody: FormData | undefined
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as FormData
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ doc: { id: 42, url: 'https://cos.example.com/cover-42.jpg' } }),
      })
    }) as unknown as typeof fetch

    const result = await uploadCoverMedia(makeFile(), '陆家嘴商圈封面')

    expect(result).toEqual({ id: 42, url: 'https://cos.example.com/cover-42.jpg' })
    expect(capturedBody).toBeInstanceOf(FormData)
    const payloadField = capturedBody?.get('_payload')
    expect(typeof payloadField).toBe('string')
    expect(JSON.parse(payloadField as string)).toEqual({ alt: '陆家嘴商圈封面' })
  })
})
