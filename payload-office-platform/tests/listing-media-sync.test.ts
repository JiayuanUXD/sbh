import { describe, expect, it } from 'vitest'

import { syncListingMedia } from '@/collections/Listings'

type HookData = Parameters<typeof syncListingMedia>[0]['data']
type HookOriginalDoc = Parameters<typeof syncListingMedia>[0]['originalDoc']

function run(data: HookData, originalDoc?: HookOriginalDoc) {
  const result = syncListingMedia({
    data,
    originalDoc,
    // 其余参数派生 hook 不消费，置空即可
  } as Parameters<typeof syncListingMedia>[0])
  return result as HookData
}

function imageItem(id: number, overrides: Record<string, unknown> = {}) {
  return { kind: 'image', resource: id, category: 'workspace', alt: `图 ${id}`, ...overrides }
}

describe('syncListingMedia（房源媒体工作台派生 hook）', () => {
  it('新建链路：mediaItems 派生 gallery 与封面兜底', () => {
    const data = run({
      title: '静安寺精装办公室',
      mediaItems: [imageItem(11), imageItem(12), imageItem(13, { kind: 'video' })],
    })

    // gallery = kind=image 的 resource 列表（视频不入相册）
    expect(data.gallery).toEqual([{ image: 11 }, { image: 12 }])
    // 无封面时自动取第一张图
    expect(data.coverImage).toBe(11)
  })

  it('存量兼容：双方都无 mediaItems 时不派生，legacy gallery 原样保留', () => {
    const legacyGallery = [{ image: 21 }, { image: 22 }]
    const data = run(
      { title: '外部抓取房源', mediaItems: [], gallery: legacyGallery },
      { mediaItems: [], gallery: legacyGallery },
    )

    expect(data.gallery).toBe(legacyGallery)
    expect(data.coverImage).toBeUndefined()
  })

  it('mediaItems 缺失（非表单链路）同样保留 legacy gallery', () => {
    const legacyGallery = [{ image: 31 }]
    const data = run(
      { title: '老房源', gallery: legacyGallery },
      { gallery: legacyGallery },
    )

    expect(data.gallery).toBe(legacyGallery)
  })

  it('首次切换工作台链路：legacy gallery 回填进 mediaItems 头部且去重', () => {
    const data = run(
      { title: '混合来源房源', mediaItems: [imageItem(41), imageItem(42)] },
      {
        mediaItems: [],
        // 51/52 为存量图；41 已在新上传里，回填应跳过
        gallery: [{ image: 51 }, { image: 41 }, { image: 52 }],
      },
    )

    // 回填 2 张（51/52）在前，新上传 2 张（41/42）在后
    expect((data.mediaItems as { resource: number }[]).map((m) => m.resource)).toEqual([
      51, 52, 41, 42,
    ])
    // 回填条目补齐必填字段
    const backfilled = (data.mediaItems as { resource: number; alt: string }[])[0]
    expect(backfilled.alt).toBe('混合来源房源 图集 1')
    // gallery 覆盖全部图片
    expect(data.gallery).toEqual([{ image: 51 }, { image: 52 }, { image: 41 }, { image: 42 }])
  })

  it('已在工作台链路：删光 mediaItems 是合法操作，gallery 同步清空', () => {
    const data = run(
      { title: '清理媒体', mediaItems: [], coverImage: undefined },
      {
        mediaItems: [imageItem(61)],
        gallery: [{ image: 61 }],
        coverImage: 61,
      },
    )

    expect(data.mediaItems).toEqual([])
    expect(data.gallery).toEqual([])
  })

  it('封面保护：运营手选封面不被第一张图重置', () => {
    const data = run(
      { title: '手选封面', mediaItems: [imageItem(71), imageItem(72)], coverImage: 72 },
      { mediaItems: [imageItem(71), imageItem(72)], coverImage: 72 },
    )

    expect(data.coverImage).toBe(72)
  })

  it('originalDoc 有封面而表单未提交封面字段时同样保留手选封面', () => {
    const data = run(
      { title: 'hidden 封面', mediaItems: [imageItem(81), imageItem(82)] },
      { mediaItems: [imageItem(81)], coverImage: 82 },
    )

    // hook 只负责「无封面时兜底」；有封面时不覆盖 data.coverImage（undefined），
    // Payload 写入时会合并 originalDoc 的 82，运营手选封面因此不会被重置。
    expect(data.coverImage).toBeUndefined()
  })
})

describe('syncListingMedia：已上架媒体地板（拦截静默下架）', () => {
  it('已上架房源经工作台保存后图片不足 3 张 → 抛错拦截，不落库', () => {
    expect(() =>
      run(
        {
          title: '陆家嘴甲级 780㎡',
          publicationStatus: 'published',
          // 4 个媒体但只有 2 张图片：视频 / 平面图不计入有效供给 §6
          mediaItems: [
            imageItem(101),
            imageItem(102),
            imageItem(103, { kind: 'video' }),
            imageItem(104, { kind: 'floor-plan' }),
          ],
        },
        { publicationStatus: 'published', mediaItems: [imageItem(101)] },
      ),
    ).toThrow(/至少需要 3 张/)
  })

  it('发布状态只在 originalDoc 上时同样拦截（表单未提交该 hidden 字段）', () => {
    expect(() =>
      run(
        { title: '静安寺 42 工位', mediaItems: [imageItem(111), imageItem(112)] },
        { publicationStatus: 'published', mediaItems: [imageItem(111)] },
      ),
    ).toThrow(/至少需要 3 张/)
  })

  it('图片达标 → 放行', () => {
    const data = run(
      {
        title: '合规房源',
        publicationStatus: 'published',
        mediaItems: [imageItem(121), imageItem(122), imageItem(123), imageItem(124, { kind: 'video' })],
      },
      { publicationStatus: 'published', mediaItems: [imageItem(121)] },
    )

    expect(data.gallery).toEqual([{ image: 121 }, { image: 122 }, { image: 123 }])
  })

  it('草稿 / 已下架不拦截——草稿期允许边攒边存', () => {
    for (const status of ['draft', 'unpublished', 'leased']) {
      const data = run(
        { title: '草稿房源', publicationStatus: status, mediaItems: [imageItem(131)] },
        { publicationStatus: status, mediaItems: [imageItem(131), imageItem(132)] },
      )
      expect(data.gallery).toEqual([{ image: 131 }])
    }
  })

  it('纯存量链路（未走工作台）不受地板约束——本次改动不改写既有数据', () => {
    const legacyGallery = [{ image: 141 }]
    const data = run(
      { title: '存量已上架房源', publicationStatus: 'published', gallery: legacyGallery },
      { publicationStatus: 'published', gallery: legacyGallery },
    )

    expect(data.gallery).toBe(legacyGallery)
  })
})
