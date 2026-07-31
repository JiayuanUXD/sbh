import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import React from 'react'
import ListingCard from '@/components/frontend/ListingCard'
import ModalDemo from '@/components/frontend/dev/ModalDemo'
import {
  Breadcrumb,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListingCardSkeleton,
  Media,
  Price,
  Select,
  Skeleton,
  Tag,
  Textarea,
} from '@/components/frontend/ui'
import type { ListingCardViewModel } from '@/domain/public-catalog'

/**
 * dev-story：F2.5 状态走查页
 *
 * 设计依据：specs/frontend-mvp/design.md §15.4、tasks.md F2.5
 *
 * 守护不变量：
 *   - 仅开发环境可用，生产环境直接 404；
 *   - metadata 禁止索引与跟踪；
 *   - 不出现在公开 sitemap 中；
 *   - 所有数据均为 fixture，不读取 Payload。
 *
 * 视口走查清单（design.md §15.4）：
 *   375×812 / 768×1024 / 1440×900 / 1920×1080
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'dev-story · 状态走查',
  description: '仅供开发环境使用的 UI 状态走查页',
  robots: { index: false, follow: false },
}

const VIEWPORTS = [
  { label: '移动竖屏', size: '375 × 812' },
  { label: '平板竖屏', size: '768 × 1024' },
  { label: '桌面标准', size: '1440 × 900' },
  { label: '桌面宽屏', size: '1920 × 1080' },
] as const

// ---------------------------------------------------------------------------
// Fixture：覆盖长标题 / 无图 / 极值价格 / 三种租金单位 / 无亮点 / 无价格 / 无楼盘 / 推荐
// ---------------------------------------------------------------------------

const BASE_FAVORITE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
      <rect width="400" height="300" fill="#e8d9c5"/>
      <text x="50%" y="50%" font-family="sans-serif" font-size="24" fill="#a46f3f" text-anchor="middle" dominant-baseline="middle">封面示例</text>
    </svg>`,
  )

const BROKEN_IMAGE_SRC = 'https://invalid.invalid.invalid/sample.png'

function price(
  amount: number,
  displayUnit: 'rmb-sqm-day' | 'rmb-month' | 'rmb-seat-month',
  text: string,
) {
  const key = displayUnit === 'rmb-sqm-day'
    ? { period: 'day' as const, basis: 'sqm' as const }
    : displayUnit === 'rmb-seat-month'
      ? { period: 'month' as const, basis: 'seat' as const }
      : { period: 'month' as const, basis: 'total' as const }
  return { amount, currency: 'CNY' as const, businessType: 'lease' as const, ...key, displayUnit, text }
}

function makeListing(
  overrides: Partial<ListingCardViewModel> & { id: number; slug: string; title: string },
): ListingCardViewModel {
  return {
    price: price(8.5, 'rmb-sqm-day', '8.5 元/㎡·天'),
    area: 120,
    businessType: 'lease',
    decorationStatus: null,
    listingType: 'traditional-office',
    availableFrom: '2026-08-01',
    isFeatured: false,
    building: {
      id: 1,
      slug: 'jing-an-center',
      name: '静安中心',
      address: '上海市静安区南京西路 1788 号',
      grade: 'grade-a',
      district: { id: 1, slug: 'jing-an', name: '静安区' },
      coverImage: {
        src: BASE_FAVORITE_IMAGE,
        alt: '静安中心封面',
        width: 400,
        height: 300,
      },
    },
    coverImage: {
      src: BASE_FAVORITE_IMAGE,
      alt: '示例房源封面',
      width: 400,
      height: 300,
    },
    highlights: ['可分割', '带家具', '独立空调'],
    stableSortKey: '100001',
    ...overrides,
  }
}

const FIXTURES = {
  normal: makeListing({
    id: 1,
    slug: 'normal',
    title: '静安中心 12F 整层办公',
  }),
  longTitle: makeListing({
    id: 2,
    slug: 'long-title',
    title: '陆家嘴金融核心区超甲级写字楼整层大面积精装修带独立电梯与全景落地窗房源出租',
  }),
  noImage: makeListing({
    id: 3,
    slug: 'no-image',
    title: '无图房源（占位测试）',
    coverImage: null,
  }),
  brokenImage: makeListing({
    id: 4,
    slug: 'broken-image',
    title: '图片加载失败（onError 测试）',
    coverImage: {
      src: BROKEN_IMAGE_SRC,
      alt: '失败占位',
      width: 400,
      height: 300,
    },
  }),
  extremeHigh: makeListing({
    id: 5,
    slug: 'extreme-high',
    title: '极值价格 · 高（元/月）',
    price: price(999999, 'rmb-month', '999,999 元/月'),
    area: 800,
  }),
  extremeLow: makeListing({
    id: 6,
    slug: 'extreme-low',
    title: '极值价格 · 低（元/㎡·天）',
    price: price(0.01, 'rmb-sqm-day', '0.01 元/㎡·天'),
    area: 30,
  }),
  rentSqmDay: makeListing({
    id: 7,
    slug: 'unit-sqm-day',
    title: '租金单位 · 元/㎡·天',
    price: price(6.5, 'rmb-sqm-day', '6.5 元/㎡·天'),
  }),
  rentMonth: makeListing({
    id: 8,
    slug: 'unit-month',
    title: '租金单位 · 元/月',
    price: price(18000, 'rmb-month', '18,000 元/月'),
  }),
  rentSeatMonth: makeListing({
    id: 9,
    slug: 'unit-seat-month',
    title: '租金单位 · 元/工位/月',
    price: price(2200, 'rmb-seat-month', '2,200 元/工位/月'),
    listingType: 'coworking',
  }),
  noHighlights: makeListing({
    id: 10,
    slug: 'no-highlights',
    title: '无亮点（标签区不渲染）',
    highlights: [],
  }),
  noPrice: makeListing({
    id: 11,
    slug: 'no-price',
    title: '价格待面议（null price）',
    price: null,
  }),
  noBuilding: makeListing({
    id: 12,
    slug: 'no-building',
    title: '无楼盘信息（meta 仅类型 + 面积）',
    building: null,
  }),
  featured: makeListing({
    id: 13,
    slug: 'featured',
    title: '推荐房源（isFeatured=true）',
    isFeatured: true,
  }),
} as const

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DevStoryPage() {
  // 生产环境直接 404，保证该路由只在开发环境可见
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <div className="dev-story">
      <header className="dev-story__header">
        <h1>dev-story · 状态走查</h1>
        <p>
          仅供开发环境使用，用于在设计四档视口下逐一检查 UI 原语、房源卡片与状态展示。
          所有数据为 fixture，不读取 Payload。该页面不出现在公开 sitemap，且 metadata 标记为
          <code> noindex,nofollow</code>。
        </p>
        <div className="dev-story__viewports" aria-label="视口清单">
          {VIEWPORTS.map((v) => (
            <span key={v.size} className="dev-story__viewport-chip">
              <span aria-hidden="true">⛶</span>
              {v.label} · {v.size}
            </span>
          ))}
        </div>
        <p className="dev-story__note" style={{ marginTop: 'var(--sp-3)' }}>
          说明：design.md §19 明确「以租赁场景为主」，出售房源在 MVP 中与租赁分开计价与聚合；
          当前 Listing DTO 仅含 4 种租赁类型，出售类型留待后续阶段补 fixture。
        </p>
      </header>

      {/* ----------------------------------------------------------------- */}
      {/* 1. 房源卡片状态走查                                                */}
      {/* ----------------------------------------------------------------- */}
      <section className="dev-story__section" aria-labelledby="sec-card">
        <h2 id="sec-card" className="dev-story__section-title">
          1. 房源卡片（ListingCard）状态
        </h2>
        <p className="dev-story__section-desc">
          4:3 媒体 · 最多三项亮点 · 价格 tabular-nums · 键盘焦点由全局 :focus-visible 保障 ·
          图片失败回退占位
        </p>
        <div className="dev-story__grid">
          <CardFixture label="正常" listing={FIXTURES.normal} />
          <CardFixture label="长标题（2 行 clamp）" listing={FIXTURES.longTitle} />
          <CardFixture label="无封面（占位）" listing={FIXTURES.noImage} />
          <CardFixture label="图片加载失败" listing={FIXTURES.brokenImage} />
          <CardFixture label="极值价格 · 高" listing={FIXTURES.extremeHigh} />
          <CardFixture label="极值价格 · 低" listing={FIXTURES.extremeLow} />
          <CardFixture label="单位 · 元/㎡·天" listing={FIXTURES.rentSqmDay} />
          <CardFixture label="单位 · 元/月" listing={FIXTURES.rentMonth} />
          <CardFixture label="单位 · 元/工位/月" listing={FIXTURES.rentSeatMonth} />
          <CardFixture label="无亮点" listing={FIXTURES.noHighlights} />
          <CardFixture label="待面议（price=null）" listing={FIXTURES.noPrice} />
          <CardFixture label="无楼盘信息" listing={FIXTURES.noBuilding} />
          <CardFixture label="推荐房源" listing={FIXTURES.featured} />
        </div>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* 2. 加载 / 空 / 错误状态                                            */}
      {/* ----------------------------------------------------------------- */}
      <section className="dev-story__section" aria-labelledby="sec-states">
        <h2 id="sec-states" className="dev-story__section-title">
          2. 加载 / 空 / 错误状态
        </h2>
        <p className="dev-story__section-desc">
          失败不显示为 0 套；空状态保留筛选；错误状态提供下一步动作（design.md §13）
        </p>
        <div className="dev-story__grid">
          <div className="dev-story__stack">
            <p className="dev-story__label">加载 · 卡片骨架</p>
            <ListingCardSkeleton />
            <ListingCardSkeleton />
          </div>
          <div className="dev-story__stack">
            <p className="dev-story__label">空状态</p>
            <EmptyState
              title="没有符合条件的房源"
              description="试试清除部分筛选条件，或直接提交需求。"
              action={
                <Button as="link" href="/listings" variant="ghost">
                  清除筛选
                </Button>
              }
            />
          </div>
          <div className="dev-story__stack">
            <p className="dev-story__label">错误状态</p>
            <ErrorState
              title="加载失败"
              description="服务暂时不可用，请稍后重试。"
              action={<Button variant="primary">重试</Button>}
            />
          </div>
          <div className="dev-story__stack">
            <p className="dev-story__label">通用 Skeleton</p>
            <Skeleton width="100%" height="180px" />
            <Skeleton width="60%" height="20px" />
            <Skeleton width="80%" height="14px" />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* 3. UI 原语                                                        */}
      {/* ----------------------------------------------------------------- */}
      <section className="dev-story__section" aria-labelledby="sec-primitives">
        <h2 id="sec-primitives" className="dev-story__section-title">
          3. UI 原语
        </h2>
        <p className="dev-story__section-desc">
          Button / Tag / Price / Media / Breadcrumb · 触控目标 ≥ 44×44px · 全局 :focus-visible
        </p>

        <div className="dev-story__stack">
          <div>
            <p className="dev-story__label">Button · variant</p>
            <div className="dev-story__row">
              <Button variant="primary">primary</Button>
              <Button variant="ghost">ghost</Button>
              <Button variant="ink">ink</Button>
            </div>
          </div>
          <div>
            <p className="dev-story__label">Button · size</p>
            <div className="dev-story__row">
              <Button variant="primary" size="sm">
                sm
              </Button>
              <Button variant="primary" size="md">
                md
              </Button>
              <Button variant="primary" size="lg">
                lg
              </Button>
            </div>
          </div>
          <div>
            <p className="dev-story__label">Button · 状态</p>
            <div className="dev-story__row">
              <Button variant="primary" loading>
                加载中
              </Button>
              <Button variant="primary" disabled>
                disabled
              </Button>
              <Button variant="primary" block>
                block
              </Button>
            </div>
          </div>
          <div>
            <p className="dev-story__label">Button · as link</p>
            <div className="dev-story__row">
              <Button as="link" href="/listings" variant="primary">
                跳到房源列表
              </Button>
              <Button as="link" href="/" variant="ghost">
                返回首页
              </Button>
            </div>
          </div>

          <div>
            <p className="dev-story__label">Tag · variant / size</p>
            <div className="dev-story__row">
              <Tag>default</Tag>
              <Tag variant="copper">copper</Tag>
              <Tag variant="forest">forest</Tag>
              <Tag size="lg">lg size</Tag>
            </div>
          </div>

          <div>
            <p className="dev-story__label">Price · size / 单位 / 缺失</p>
            <div className="dev-story__stack">
              <Price
                size="sm"
                price={{ text: '6.5 元/㎡·天', value: 6.5, currency: 'CNY', unit: 'rmb-sqm-day' }}
              />
              <Price
                size="md"
                price={{ text: '18,000 元/月', value: 18000, currency: 'CNY', unit: 'rmb-month' }}
              />
              <Price
                size="lg"
                price={{
                  text: '2,200 元/工位/月',
                  value: 2200,
                  currency: 'CNY',
                  unit: 'rmb-seat-month',
                }}
              />
              <Price size="md" price={null} />
            </div>
          </div>

          <div>
            <p className="dev-story__label">Media · 比例 / 失败 / 缺失</p>
            <div className="dev-story__row" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 200 }}>
                <Media
                  ratio="4/3"
                  media={{
                    src: BASE_FAVORITE_IMAGE,
                    alt: '4:3 示例',
                    width: 400,
                    height: 300,
                  }}
                />
              </div>
              <div style={{ width: 200 }}>
                <Media ratio="16/10" media={{ src: BASE_FAVORITE_IMAGE, alt: '16:10 示例' }} />
              </div>
              <div style={{ width: 200 }}>
                <Media ratio="1/1" media={null} fallbackAlt="缺失占位" />
              </div>
              <div style={{ width: 200 }}>
                <Media
                  ratio="4/3"
                  media={{ src: BROKEN_IMAGE_SRC, alt: '失败占位' }}
                  fallbackAlt="失败占位"
                />
              </div>
            </div>
          </div>

          <div>
            <p className="dev-story__label">Breadcrumb</p>
            <Breadcrumb
              items={[
                { label: '首页', href: '/' },
                { label: '在租房源', href: '/listings' },
                { label: '静安中心 12F 整层办公' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* 4. 表单字段                                                       */}
      {/* ----------------------------------------------------------------- */}
      <section className="dev-story__section" aria-labelledby="sec-form">
        <h2 id="sec-form" className="dev-story__section-title">
          4. 表单字段
        </h2>
        <p className="dev-story__section-desc">
          label / hint / error 通过 aria-describedby 关联；error 用 role=&quot;alert&quot; 朗读
        </p>
        <div
          className="dev-story__grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          <Field id="f-normal" label="姓名" hint="用于联系顾问时称呼">
            <Input name="name" autoComplete="name" placeholder="请输入姓名…" />
          </Field>
          <Field id="f-error" label="手机" error="请输入有效的 11 位手机号" required>
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="请输入手机号…"
              invalid
            />
          </Field>
          <Field id="f-select" label="办公类型" hint="可多选筛选">
            <Select name="type" defaultValue="">
              <option value="" disabled>
                请选择…
              </option>
              <option value="traditional-office">传统办公</option>
              <option value="serviced-office">服务式办公</option>
              <option value="coworking">共享办公</option>
            </Select>
          </Field>
          <Field id="f-textarea" label="留言">
            <Textarea name="message" rows={3} placeholder="可选，说明需求…" />
          </Field>
          <Field id="f-disabled" label="禁用字段">
            <Input name="locked" value="禁止编辑" disabled readOnly />
          </Field>
        </div>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* 5. Modal 演示                                                     */}
      {/* ----------------------------------------------------------------- */}
      <section className="dev-story__section" aria-labelledby="sec-modal">
        <h2 id="sec-modal" className="dev-story__section-title">
          5. Modal 弹层
        </h2>
        <p className="dev-story__section-desc">
          role=dialog + aria-modal · 焦点锁定 · Esc 关闭 · 关闭后焦点归还触发器 ·
          背景滚动锁定
        </p>
        <ModalDemo />
        <p className="dev-story__note" style={{ marginTop: 'var(--sp-4)' }}>
          验证清单：Tab 在弹层内循环 / Shift+Tab 反向 / Esc 关闭 / 关闭后焦点回到触发按钮 /
          背景不滚动
        </p>
      </section>

      {/* ----------------------------------------------------------------- */}
      {/* 6. 跳转入口                                                       */}
      {/* ----------------------------------------------------------------- */}
      <section className="dev-story__section" aria-labelledby="sec-nav">
        <h2 id="sec-nav" className="dev-story__section-title">
          6. 全站导航
        </h2>
        <p className="dev-story__section-desc">验证 SiteNav / SiteFooter 在四档视口下表现</p>
        <div className="dev-story__row">
          <Button as="link" href="/" variant="primary">
            首页
          </Button>
          <Button as="link" href="/listings" variant="ghost">
            在租房源
          </Button>
          <Link href="/" className="dev-story__note" style={{ textDecoration: 'none' }}>
            返回首页 →
          </Link>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 内部辅助：fixture 卡片 + 标签
// ---------------------------------------------------------------------------

function CardFixture({
  label,
  listing,
}: {
  label: string
  listing: ListingCardViewModel
}) {
  return (
    <div className="dev-story__stack">
      <p className="dev-story__label">{label}</p>
      <ListingCard listing={listing} />
    </div>
  )
}
