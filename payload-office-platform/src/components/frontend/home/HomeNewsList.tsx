import Link from 'next/link'
import React from 'react'
import type { ArticleCardViewModel } from '@/domain/public-catalog/contracts'
import { formatPublishedDate } from '@/lib/frontend/format'

/**
 * OPT-035 首页「资讯」分区：白底带，无图纯文字列表（行高 76），取前 5 条。
 *
 * 日期格式改用 formatPublishedDate（YYYY.MM.DD），不再用旧 NewsSection 的
 * formatNewsListDate（MM/DD）：
 *   - 旧格式的理由写在 format.ts 里——「对齐 homepage-preview.html 资讯列表的
 *     56px 日期列」，那个窄列在本次改版后已不存在（新行是 flex 两端对齐、
 *     日期 flex:none 右对齐，宽度不受限）；
 *   - 设计稿要求显示完整年月日（`2026-08-14`），MM/DD 藏掉了年份；
 *   - `/news` 列表（ArticleCard）与文章详情页都用 formatPublishedDate，
 *     同一条数据在站内应当只有一种写法。分隔符沿用站内既有的 `.`（而非设计稿
 *     的 `-`）：设计稿定的是「显示完整日期」这件事，而站内已有唯一权威格式，
 *     为同一个字段引入第二种分隔符只会制造不一致。
 * 「更多」链接与逐条点击的埋点名沿用旧 NewsSection（home_news_view_all / home_news_click）。
 */
export default function HomeNewsList({ articles, citySlug }: Readonly<{
  articles: readonly ArticleCardViewModel[]
  citySlug?: string
}>) {
  if (articles.length === 0) return null
  const prefix = citySlug ? `/${citySlug}` : ''
  const items = articles.slice(0, 5)
  return (
    <section className="hm-band hm-news" aria-labelledby="hm-news-title">
      <div className="hm-container">
        <div className="hm-section-head">
          <h2 className="hm-h2" id="hm-news-title">资讯</h2>
          <Link href={`${prefix}/news`} prefetch={false} className="hm-section-link" data-event-name="home_news_view_all">更多资讯 →</Link>
        </div>
        <ul className="hm-news__list" role="list">
          {items.map((a) => (
            <li className="hm-news__item" key={a.id}>
              <Link
                href={`${prefix}/news/${a.slug}`}
                prefetch={false}
                className="hm-news__row"
                data-event-name="home_news_click"
                data-news-id={a.id}
              >
                <span className="hm-news__title">{a.title}</span>
                {/* formatPublishedDate 对 null / 不可解析的值返回 ''，会渲染成一个
                    空日期格；设计系统硬约束是「数值缺失显示 —」，这里显式兜底。 */}
                <span className="hm-news__date sf-num">{formatPublishedDate(a.publishedAt) || '—'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
