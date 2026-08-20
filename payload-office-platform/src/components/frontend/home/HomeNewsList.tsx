import Link from 'next/link'
import React from 'react'
import type { ArticleCardViewModel } from '@/domain/public-catalog/contracts'
import { formatNewsListDate } from '@/lib/frontend/format'

/**
 * OPT-035 首页「资讯」分区：白底带，无图纯文字列表（行高 76），取前 5 条。
 * 日期格式沿用旧 NewsSection 的 formatNewsListDate（MM/DD，Asia/Shanghai）；
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
                <span className="hm-news__date hm-num">{formatNewsListDate(a.publishedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
