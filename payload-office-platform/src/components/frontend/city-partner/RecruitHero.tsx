import React from 'react'

/**
 * OPT-038 城市招募页 · Hero（Task 2）
 *
 * 设计依据：docs/SBH设计任务讨论/城市招募页.dc.html:62-71 与末尾 specRows
 *   - Hero 标题：56 / 600 / 1.07 / letter-spacing normal
 *   - Hero 副标：21 / 400 / 1.38 / +0.011em（全站唯一允许非 normal 字距的档位）
 *   - 眉标 pill：12 / 500 · padding 4/10 · 零色相
 * 样式全部在 styles/recruit.css 的 `.rc-hero*`，本文件不带任何内联样式。
 *
 * ── Server Component ──────────────────────────────────────────────────────
 * 无 'use client'、无 hook、不读 Payload：只消费调用方给的 DTO 文案。
 * 两个消费面（`/city-partner` 中性文案 / `/[city]` 城市专属文案）共用本组件，
 * 差异全部由 props 承载——Task 5 接线，本任务只交付组件本身。
 *
 * ── 标题固定是 h1，不做 `as` / `level` 开关 ───────────────────────────────
 * 招募页的 Hero 标题就是该页主标题。做成可切换的话，两个消费面里任何一处忘了
 * 摘掉自己原有的 h1，页面就会出现两个 h1——`tests/city-partner-page-seo.test.ts:37`
 * 锁的正是「恰好 1 个 h1」。固定 h1 让「谁是主标题」只有一个答案，
 * 接线方必须显式删掉旧 h1 才能编译通过语义，而不是静默叠加。
 */

/**
 * 眉标默认文案。
 *
 * ⚠️ 稿子写的是「城市合伙人 · **第 8 城**」，这里**刻意去掉了序数**。
 *
 * 按字段可得性三层判定：
 *   ① 手里的 DTO：`listPublicCityOptions()` / `listPublicCityProfiles()` 带
 *      `serviceStatus`，**已开通城市数是拿得到的**（`livePlatformStatsSlugs`
 *      就是这个口径的唯一事实源）。所以「城市计数」不是障碍。
 *   ② 缺映射：没有任何「开城序号 / 招募批次」字段停在 mapper 门口等着被映射。
 *   ③ collection：`CitySiteProfiles` 只有 `serviceStatus`（live / coming-soon
 *      二值）与 `sortOrder`（字段 label 就是「排序」，defaultValue 100，
 *      七座城市允许并列）——**整条链路没有「第几城」这个维度**。
 *
 * 于是「第 N 城」拿不到，理由不是查不到数，而是这个序数在数据里根本不存在。
 * 若硬用「已开通城市数 + 1」顶上，会立刻撒三种谎：
 *   1. 生产种子（migrations/20260813_011000_seed_city_site_profiles.ts）是
 *      **1 座 live + 6 座 coming-soon**，同一个 N 会同时印在 6 座城市的招募页上，
 *      每一页都自称是同一个「第 N 城」；
 *   2. `/city-partner` 的默认城市是**已开通的上海**，对一座已开城的城市谈
 *      「第 N 城」本身无意义，N 取什么都不对；
 *   3. 即便只剩一座 coming-soon 城，「+1」也是在替产品承诺开城顺序，
 *      而数据层从未记录过这个顺序。
 *
 * 结论：去掉序数，眉标只留「城市合伙人」——这是当前数据能如实说出的全部。
 * 想恢复序数，前置条件是先在 `CitySiteProfiles` 上落一个真正的开城序号/批次字段
 * （含迁移 + 后台可填 + mapper 映射），与工作项 §7.1 商圈状态标签是同型遗留。
 */
export const RECRUIT_HERO_EYEBROW = '城市合伙人'

type RecruitHeroProps = Readonly<{
  /** 主标题。城市面传「商办租赁即将登陆{城市}，诚邀本地城市合伙人」，全局面传中性文案。 */
  title: string
  /** 副标。为空则整段不渲染（不留空行占位）。 */
  subtitle?: string
  /** 眉标 pill 文案；显式传空串可整体去掉 pill。默认见 RECRUIT_HERO_EYEBROW。 */
  eyebrow?: string
  /** h1 的 id，供外层 `aria-labelledby` 指向；不传则不给 section 加 aria-labelledby。 */
  titleId?: string
}>

export default function RecruitHero({
  title,
  subtitle,
  eyebrow = RECRUIT_HERO_EYEBROW,
  titleId,
}: RecruitHeroProps) {
  return (
    <section className="rc-section" {...(titleId ? { 'aria-labelledby': titleId } : {})}>
      <div className="rc-container rc-hero">
        {eyebrow ? <span className="rc-hero__eyebrow">{eyebrow}</span> : null}
        <h1 className="rc-hero__title" {...(titleId ? { id: titleId } : {})}>
          {title}
        </h1>
        {subtitle ? <p className="rc-hero__lead rc-measure">{subtitle}</p> : null}
      </div>
    </section>
  )
}
