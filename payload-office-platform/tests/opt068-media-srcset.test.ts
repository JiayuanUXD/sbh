/**
 * OPT-068 派生尺寸 srcset。
 *
 * 线上抽样：最近 300 张媒体里 169 张没有 `sizes.card`、203 张原图 > 500KB；首页热门
 * 楼盘两张封面各 1.7MB / 1.8MB，而卡片只有 ~360px 宽。前端这一半（发 srcset）在这里
 * 锁住，缺的派生文件由 `scripts/backfill-media-sizes.ts` 补。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSrcSet, cardCoverProps } from '@/lib/frontend/media-srcset'
import type { MediaViewModel } from '@/domain/public-catalog'

const SRC = path.resolve(__dirname, '..', 'src')

const withVariants: MediaViewModel = {
  src: '/api/media/file/a.jpg?prefix=media',
  alt: '封面',
  variants: [
    { src: '/api/media/file/a-320x213.webp?prefix=media', width: 320 },
    { src: '/api/media/file/a-768x512.webp?prefix=media', width: 768 },
    { src: '/api/media/file/a-1600x1067.webp?prefix=media', width: 1600 },
  ],
}

const withoutVariants: MediaViewModel = { src: '/api/media/file/b.jpg?prefix=media', alt: '封面' }

describe('OPT-068 srcset 构造', () => {
  it('有派生：按宽度升序拼 srcset', () => {
    expect(buildSrcSet(withVariants)).toBe(
      '/api/media/file/a-320x213.webp?prefix=media 320w, /api/media/file/a-768x512.webp?prefix=media 768w, /api/media/file/a-1600x1067.webp?prefix=media 1600w',
    )
  })

  it('没有派生（存量图常态）：不发 srcset', () => {
    expect(buildSrcSet(withoutVariants)).toBeUndefined()
    expect(buildSrcSet({ variants: [] })).toBeUndefined()
    expect(buildSrcSet({ variants: null })).toBeUndefined()
  })

  it('卡片封面：src 取 ≥ 目标宽度的最小档，并带上 sizes', () => {
    expect(cardCoverProps(withVariants, '(max-width: 767px) 100vw, 320px')).toEqual({
      src: '/api/media/file/a-768x512.webp?prefix=media',
      srcSet: buildSrcSet(withVariants),
      sizes: '(max-width: 767px) 100vw, 320px',
    })
    // 缩略图位：目标 320 时取 320 档
    expect(cardCoverProps(withVariants, '160px', 320).src).toBe('/api/media/file/a-320x213.webp?prefix=media')
  })

  it('没有派生时退回原图，且不发无意义的 sizes', () => {
    expect(cardCoverProps(withoutVariants, '320px')).toEqual({ src: '/api/media/file/b.jpg?prefix=media' })
  })
})

describe('OPT-068 楼盘封面消费方', () => {
  const CONSUMERS = [
    'components/frontend/home/HomeSupplyCard.tsx',
    'components/frontend/listing/BuildingResultCard.tsx',
    'components/frontend/listing/BuildingCompactRow.tsx',
    'components/frontend/BuildingSummaryCard.tsx',
    'components/frontend/BuildingCardMini.tsx',
    'components/frontend/building-detail/NearbyBuildingsStrip.tsx',
  ] as const

  it('六处手写 <img> 全部改走 cardCoverProps，不再直出原图 src', () => {
    for (const rel of CONSUMERS) {
      const source = readFileSync(path.join(SRC, rel), 'utf8')
      expect(source, rel).toContain('cardCoverProps(')
      expect(source, rel).not.toMatch(/<img\s+src=\{(coverImage|image|item\.coverImage)\.src\}/)
    }
  })

  it('Media 组件与它们共用同一份 srcset 拼法', () => {
    const media = readFileSync(path.join(SRC, 'components/frontend/ui/Media.tsx'), 'utf8')
    expect(media).toContain('buildSrcSet(media)')
    expect(media).not.toContain("map((v) => `${v.src} ${v.width}w`)")
  })
})

describe('OPT-068 回填脚本', () => {
  const script = readFileSync(path.resolve(__dirname, '..', 'scripts', 'backfill-media-sizes.ts'), 'utf8')

  it('默认 dry-run，只有 --execute 才写库', () => {
    expect(script).toContain("const EXECUTE = process.argv.includes('--execute')")
    expect(script).toContain('if (!EXECUTE)')
    expect(script).toContain('dry-run：未写入任何数据')
  })

  it('同名回写以保住既有 media.url（引用不用改、不产生重名副本）', () => {
    expect(script).toContain('overwriteExistingFiles: true')
    expect(script).toContain('name: doc.filename')
  })

  it('只处理缺派生的图片，且回写后校验 sizes.card.url 真的出现了', () => {
    expect(script).toContain("doc.mimeType.startsWith('image/')")
    expect(script).toContain('!doc.sizes?.card?.url')
    expect(script).toContain("throw new Error('回写后仍无 sizes.card.url')")
  })

  it('package.json 暴露 media:backfill-sizes', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['media:backfill-sizes']).toContain('scripts/backfill-media-sizes.ts')
  })
})
