import { describe, expect, it, vi } from 'vitest'

/**
 * OPT-069 整支评审 Finding 1（Critical）分支 B。
 *
 * `scripts/backfill-media-sizes.ts` 不属于 OPT-069，却在 `package.json` 与上线手册里，
 * 且是**唯一一条会把「当前母版」当成新上传回写**的路径（HTTP 读回 → `payload.update({ file })`）。
 * 水印烘进像素之后那个母版已经带水印：回写会让 `watermarkPlugin` 把带水印的字节备份进
 * `media-source/` 当「干净原件」（唯一的干净副本永久丢失），再叠第二层水印。
 *
 * 规定的上线顺序里它跑在水印开关打开之前，所以今天是安全的——但那是靠顺序保证的，
 * 不是靠代码。本测试把它变成代码保证的。
 *
 * 之所以要 mock `payload.config`：脚本顶层 import 了整份 Payload 配置，测试只关心那个纯谓词。
 */
vi.mock('../src/payload.config', () => ({ default: {} }))

const { needsBackfill, isWatermarkBaked } = await import('../scripts/backfill-media-sizes')

const missingCard = {
  id: 1,
  mimeType: 'image/jpeg',
  filename: 'office.jpg',
  sizes: { card: null },
}

describe('backfill-media-sizes 的水印守卫', () => {
  it('缺派生且没烘过水印 → 照常回填', () => {
    expect(needsBackfill({ ...missingCard, watermark: null })).toBe(true)
    expect(needsBackfill({ ...missingCard, watermark: { version: null } })).toBe(true)
  })

  it('已烘过水印（watermark.version 有值）→ 跳过，哪怕缺派生', () => {
    // 回写它 = 把带水印的母版当新上传：干净原件被覆盖 + 水印叠第二层，且没有任何报错。
    expect(needsBackfill({ ...missingCard, watermark: { version: 'abc123def4567890' } })).toBe(false)
  })

  it('已有派生的仍然跳过——原有幂等性不受影响', () => {
    expect(
      needsBackfill({ ...missingCard, sizes: { card: { url: '/x-768.webp' } }, watermark: null }),
    ).toBe(false)
  })

  it('非图片跳过', () => {
    expect(needsBackfill({ ...missingCard, mimeType: 'video/mp4', watermark: null })).toBe(false)
  })

  it('isWatermarkBaked 只认非空字符串——空串 / null / 缺字段都读作「没烘过」', () => {
    expect(isWatermarkBaked({ id: 1, watermark: { version: 'v1' } })).toBe(true)
    expect(isWatermarkBaked({ id: 1, watermark: { version: '' } })).toBe(false)
    expect(isWatermarkBaked({ id: 1, watermark: { version: null } })).toBe(false)
    expect(isWatermarkBaked({ id: 1 })).toBe(false)
  })
})
