import Link from 'next/link'
import React from 'react'
import type { ArticleCardViewModel } from '@/domain/public-catalog'
import { formatPublishedDate } from '@/lib/frontend/format'

/**
 * 资讯卡片（/news 列表页网格用）
 *
 * 守护不变量：
 *   - 只消费 ArticleCardViewModel DTO；
 *   - 封面缺失时降级为纸色占位，不渲染破碎图；
 *   - 卡片整体可点击到 /news/[slug]；标题悬停变铜色；
 *   - 只用设计 token。
 */
type Props = Readonly<{
  article: ArticleCardViewModel
}>

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  market: '市场洞察',
  guide: '选址指南',
  building: '楼盘解读',
  industry: '行业资讯',
}

export default function ArticleCard({ article }: Props) {
  const cover = article.coverImage
  const cat = article.category ? CATEGORY_LABEL[article.category] : null
  const date = formatPublishedDate(article.publishedAt)
  return (
    <article className="article-card">
      {/* `prefetch={false}`：关停判据①高基数 ②内容驱动 ③常驻渲染**三条并列成立**
          （表述见 `ui/Breadcrumb.tsx`）。①`/news` 一页最多 12 张卡（该页
          `PAGE_SIZE = 12`），实测 5 篇 fixture 时 5 条 `/news/<slug>` 全部被自动预取；
          ②href 由文章 slug 决定；③是 `/news` 列表正文，不是空态/浮层。
          与 `listing/ListingResultCard` 完全同构，只是不在 `listing/` 目录下——
          OPT-037 Task 11c 正是按目录划界才漏掉它，Task 11d 补上。 */}
      <Link href={`/news/${article.slug}`} prefetch={false} className="article-card__link">
        <div className="article-card__media">
          {cover ? (
            <img
              src={cover.src}
              alt={cover.alt?.trim() || article.title}
              loading="lazy"
              decoding="async"
              className="article-card__img"
            />
          ) : (
            <span className="article-card__placeholder" aria-hidden="true" />
          )}
        </div>
        <div className="article-card__body">
          <div className="article-card__meta">
            {cat && <span className="article-card__cat">{cat}</span>}
            {date && <span className="article-card__date">{date}</span>}
          </div>
          <h3 className="article-card__title">{article.title}</h3>
          {article.excerpt && <p className="article-card__excerpt">{article.excerpt}</p>}
        </div>
      </Link>
    </article>
  )
}
