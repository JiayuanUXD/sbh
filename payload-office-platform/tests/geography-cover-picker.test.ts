import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCoverMediaList,
  uploadCoverMedia,
} from '@/components/admin/geography/CoverPickerModal'

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

  it('文件选择框的 accept 只允许图片类型（不能是空、通配符或带上视频）', () => {
    // 浏览器层面的第一道防线：<input accept> 不是安全边界（拖拽 / "所有文件"
    // 选项都能绕过，真正的边界在 uploadCoverMedia 里），但它决定了绝大多数用户
    // 走系统选择器时能不能选中 .mp4，所以仍然值得单独锁住。
    const acceptMatch = SRC.match(/accept=["'`]([^"'`]+)["'`]/)
    expect(acceptMatch).not.toBeNull()
    const acceptValue = acceptMatch?.[1] ?? ''
    expect(acceptValue.length).toBeGreaterThan(0)
    for (const type of acceptValue.split(',')) {
      expect(type.trim()).toMatch(/^image\//)
    }
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

  it('非图片类型（video/mp4）必须在发请求前就 throw，绝不调用 fetch', async () => {
    // 这是 accept 属性被绕过之后的最后一道防线（拖拽上传 / "所有文件"选项 /
    // 脚本化 change 事件都能跳过 <input accept>）。断言里显式确认 fetch 完全
    // 没被调用——只断言"最终 reject"防不住"先发了请求、服务端才拒绝"这种
    // 弱化实现，那样后端一旦也放宽（比如 Media 集合改了校验），这里就会悄悄失效。
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    const videoFile = new File(['fake-bytes'], 'hero-bg.mp4', { type: 'video/mp4' })
    await expect(uploadCoverMedia(videoFile, '陆家嘴商圈封面')).rejects.toThrow(/video\/mp4/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchCoverMediaList 的真实行为（素材库列表查询）', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const mockList = (docs: Array<{ id: number; mimeType: string }>) => {
    let capturedUrl: string | undefined
    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ docs, totalDocs: docs.length }),
      })
    }) as unknown as typeof fetch
    return () => capturedUrl
  }

  it('查询无条件带上 where[mimeType][like]=image 过滤（本轮要修的洞）', async () => {
    // 这条断言就是 OPT-062 视觉验收发现的真实缺陷本身：弹层曾经不带任何
    // mimeType 过滤，素材库里的 video/mp4 会被一起拉出来、渲染成裂图、还能被
    // 点击选中。
    const getUrl = mockList([{ id: 50, mimeType: 'image/jpeg' }])

    await fetchCoverMediaList({ page: 1, keyword: '' })

    const url = getUrl()
    expect(url).toContain('where%5BmimeType%5D%5Blike%5D=image')
  })

  it('带关键词搜索时，mimeType 过滤与 alt 关键词过滤同时存在（AND，不是互相替换）', async () => {
    const getUrl = mockList([{ id: 51, mimeType: 'image/jpeg' }])

    await fetchCoverMediaList({ page: 2, keyword: '陆家嘴' })

    const url = getUrl() ?? ''
    expect(url).toContain('where%5BmimeType%5D%5Blike%5D=image')
    expect(url).toContain('where%5Balt%5D%5Blike%5D=')
    expect(url).toContain('page=2')
  })

  it('非 2xx 必须 throw，且错误信息带 HTTP 状态码', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch

    await expect(fetchCoverMediaList({ page: 1, keyword: '' })).rejects.toThrow(/500/)
  })

  it('成功时原样返回 docs 与 totalDocs', async () => {
    mockList([
      { id: 50, mimeType: 'image/jpeg' },
      { id: 51, mimeType: 'image/jpeg' },
    ])

    const result = await fetchCoverMediaList({ page: 1, keyword: '' })

    expect(result.totalDocs).toBe(2)
    expect(result.docs).toHaveLength(2)
  })
})
