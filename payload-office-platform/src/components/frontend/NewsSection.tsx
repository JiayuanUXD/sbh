import Link from 'next/link'
import React from 'react'
import type { ArticleCardViewModel } from '@/domain/public-catalog'
import { formatNewsListDate } from '@/lib/frontend/format'

/**
 * 首页「资讯中心」分区：1 头条 + 日期列表（对齐 homepage-preview.html 7.8）
 *
 * 结构（preview news-grid）：
 *   - 左：news-feature 头条卡（封面 16:9 + 宋体标题 + 摘要），取 articles[0]；
 *   - 右：news-list 日期列表（MM/DD 铜色日期 + 分类胶囊 + 标题），取其余。
 * 守护不变量：
 *   - 只消费 ArticleCardViewModel DTO（id/slug/title/category/excerpt/coverImage/publishedAt）；
 *   - 头条无封面图时降级为整列纯文字列表（plans §8「仅列表无头条图→纯文字列表」）；
 *   - 空数据降级为 empty-state；头条卡与列表项整体可点击到 /news/[slug]；
 *   - 只用设计 token。
 */
type Props = Readonly<{
  articles: readonly ArticleCardViewModel[]
}>

/** 资讯分类中文名映射（与 Articles collection category 枚举对齐） */
const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  market: '市场洞察',
  guide: '选址指南',
  building: '楼盘解读',
  industry: '行业资讯',
}

function NewsListItem({ article }: Readonly<{ article: ArticleCardViewModel }>) {
  const date = formatNewsListDate(article.publishedAt)
  const cat = article.category ? CATEGORY_LABEL[article.category] : null
  return (
    <li>
      <Link
        href={`/news/${article.slug}`}
        className="news-item"
        data-event-name="home_news_click"
        data-news-id={article.id}
      >
        <span className="news-item__date">{date}</span>
        <span className="news-item__title">
          {cat && <span className="news-item__cat">{cat}</span>}
          {article.title}
        </span>
      </Link>
    </li>
  )
}

export default function NewsSection({ articles }: Props) {
  const header = (
    <div className="section__header">
      <h2 className="section__title" id="news-title">资讯中心</h2>
      <Link href="/news" className="text-copper" data-event-name="home_news_view_all">更多资讯 →</Link>
    </div>
  )

  if (articles.length === 0) {
    return (
      <section className="section news-section" aria-labelledby="news-title">
        {header}
        <p className="empty-state empty-state--inline">暂无资讯。</p>
      </section>
    )
  }

  const [feature, ...rest] = articles
  const cover = feature.coverImage

  // 头条无封面：降级为整列纯文字列表（含头条）。
  if (!cover) {
    return (
      <section className="section news-section" aria-labelledby="news-title">
        {header}
        <ul className="news-list" role="list">
          {articles.map((a) => (
            <NewsListItem key={a.id} article={a} />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="section news-section" aria-labelledby="news-title">
      {header}
      <div className="news-grid">
        <Link
          href={`/news/${feature.slug}`}
          className="news-feature"
          data-event-name="home_news_click"
          data-news-id={feature.id}
        >
          <div className="news-feature__media">
            <img
              src={cover.src}
              alt={cover.alt?.trim() || feature.title}
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="news-feature__body">
            <p className="news-feature__title">{feature.title}</p>
            {feature.excerpt && <p className="news-feature__excerpt">{feature.excerpt}</p>}
          </div>
        </Link>
        {rest.length > 0 && (
          <ul className="news-list" role="list">
            {rest.map((a) => (
              <NewsListItem key={a.id} article={a} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
