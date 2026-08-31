/**
 * 资讯（Articles）种子数据
 *
 * 用途：为前台「资讯中心」分区与 /news 路由提供真实可渲染内容，便于本地与 e2e 验证。
 * 幂等：按 slug upsert，重复运行不重复创建。
 *
 * 运行：pnpm node --env-file-if-exists=.env.local --import tsx scripts/seed-articles.ts
 */
import { getPayload } from 'payload'

import config from '../src/payload.config'
import type { Media } from '../src/payload-types'
import { upsertBySlug } from '../src/lib/runtime/upsert-by-slug'

type AnyDoc = { id: number }

/** 极简 Lexical 富文本 JSON（h2 + 段落），对齐 seed.ts 的 richText 模式。 */
function richText(heading: string, paragraphs: string[]): Record<string, unknown> {
  return {
    root: {
      type: 'root',
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
      children: [
        {
          type: 'heading',
          tag: 'h2',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          children: [
            { type: 'text', text: heading, version: 1, format: 0, style: '', mode: 'normal', detail: 0 },
          ],
        },
        ...paragraphs.map((text) => ({
          type: 'paragraph',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          textFormat: 0,
          children: [
            { type: 'text', text, version: 1, format: 0, style: '', mode: 'normal', detail: 0 },
          ],
        })),
      ],
    },
  }
}

type ArticleSeed = {
  slug: string
  title: string
  category: 'market' | 'guide' | 'building' | 'industry'
  publishedAt: string
  featuredOrder: number
  excerpt: string
  heading: string
  paragraphs: string[]
}

const ARTICLES: readonly ArticleSeed[] = [
  {
    slug: '2026-shanghai-office-market-h1',
    title: '2026 上海写字楼市场观察：核心区租金企稳，灵活办公需求上升',
    category: 'market',
    publishedAt: '2026-07-28T09:00:00+08:00',
    featuredOrder: 1,
    excerpt: '上半年上海甲级写字楼空置率回落，核心商圈租金止跌企稳；成长型企业对灵活租期与拎包入驻的需求持续升温。',
    heading: '核心区租金企稳，灵活办公需求上升',
    paragraphs: [
      '2026 年上半年，上海甲级写字楼市场迎来阶段性企稳。核心商圈空置率较去年同期回落，租金止跌，业主在续约谈判中趋于理性。',
      '与此同时，成长型企业对服务式办公与共享办公的需求明显上升，灵活租期、拎包入驻成为决策关键词。',
      '从成交结构看，100–300㎡ 的中小面积段仍是成交主力，整层成交则集中于陆家嘴与南京西路少数超甲级楼盘。',
    ],
  },
  {
    slug: 'how-to-choose-first-office-for-startup',
    title: '初创公司如何选第一间正式办公室？',
    category: 'guide',
    publishedAt: '2026-07-21T09:00:00+08:00',
    featuredOrder: 2,
    excerpt: '从预算、面积、租期到商圈选择，给成长型团队一份实用的首间办公室选址清单。',
    heading: '先想清楚三件事：预算、面积、租期',
    paragraphs: [
      '选第一间办公室前，先把预算、面积与租期三件事想清楚。预算不止是月租，还要算物业费、水电、网络与装修摊销。',
      '面积估算建议按人均 8–12㎡ 工位面积，再预留会议室与休息区。租期方面，团队仍在快速变化时优先选灵活租期。',
      '商圈选择上，靠近核心客户与人才聚集地往往比单纯压低租金更有长期价值。',
    ],
  },
  {
    slug: 'serviced-vs-traditional-office-cost-compare',
    title: '服务式办公 vs 传统办公：成本全对比',
    category: 'building',
    publishedAt: '2026-07-14T09:00:00+08:00',
    featuredOrder: 3,
    excerpt: '同样面积下，服务式办公与传统办公的真实成本差异在哪里？本文拆解租金、装修、运营三类成本。',
    heading: '同样面积，真实成本差在哪',
    paragraphs: [
      '服务式办公的报价通常已含家具、网络、物业与前台服务，入驻即可办公；传统办公则需自行装修与采购，前期投入更高。',
      '从月度现金流看，服务式办公单价偏高但无前期装修；传统办公单价更低但需摊销一次性投入。',
      '团队规模 20 人以下、租期 1 年以内时，服务式办公的综合成本往往更优。',
    ],
  },
  {
    slug: 'jingan-temple-district-why-popular',
    title: '静安寺商圈：为什么总被成长型企业偏爱',
    category: 'market',
    publishedAt: '2026-07-07T09:00:00+08:00',
    featuredOrder: 4,
    excerpt: '地铁交汇、商业成熟、甲级楼盘密集--静安寺商圈长期位居上海办公选址热门榜首。',
    heading: '交通、商业、楼盘密度三重优势',
    paragraphs: [
      '静安寺商圈拥有 2 号线与 7 号线交汇的地铁优势，通勤覆盖面广，是上海办公选址的常青树。',
      '商圈内甲级与超甲级楼盘密集，从静安嘉里中心到会德丰国际广场，选择丰富。',
      '成熟的商业配套与餐饮业态，也为企业接待与员工日常提供了便利。',
    ],
  },
  {
    slug: 'six-lease-terms-to-read-before-signing',
    title: '签写字楼租约前必须看懂的 6 个条款',
    category: 'industry',
    publishedAt: '2026-06-30T09:00:00+08:00',
    featuredOrder: 5,
    excerpt: '免租期、递增条款、违约金、恢复原状--签租约前这 6 个条款直接影响你的真实成本。',
    heading: '免租期与递增条款最容易被忽略',
    paragraphs: [
      '免租期是业主给到的装修缓冲期，签租约前要确认免租期长度与是否计入租期。',
      '递增条款决定了未来几年的租金上涨节奏，三年内递增超过 15% 的合同需谨慎评估。',
      '恢复原状条款则关系到退租时的拆除成本，建议在签约前与业主明确范围。',
    ],
  },
]

async function seed() {
  const payload = await getPayload({ config })

  // 取现有 media 作为封面（按 createdAt 倒序前 N 张）；无 media 则封面留空。
  const mediaRes = await payload.find({
    collection: 'media',
    limit: ARTICLES.length,
    sort: '-createdAt',
    depth: 0,
  })
  const mediaPool = mediaRes.docs as unknown as Media[]

  let created = 0
  let updated = 0
  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i]
    const cover = mediaPool[i % Math.max(mediaPool.length, 1)]
    const data: Record<string, unknown> = {
      title: a.title,
      slug: a.slug,
      status: 'published',
      category: a.category,
      publishedAt: a.publishedAt,
      featuredOrder: a.featuredOrder,
      excerpt: a.excerpt,
      content: richText(a.heading, a.paragraphs),
    }
    if (cover) data.coverImage = cover.id
    const result = await upsertBySlug<AnyDoc>(payload, 'articles', a.slug, data)
    if (result.created) created += 1
    else updated += 1
  }

  // biome-ignore lint/suspicious/noConsole: CLI script
  console.log(`[seed-articles] done: ${created} created, ${updated} updated (covers: ${mediaPool.length} media available)`)

  await payload.db.destroy?.()
}

seed().catch((err) => {
  console.error('[seed-articles] failed:', err)
  process.exitCode = 1
})
