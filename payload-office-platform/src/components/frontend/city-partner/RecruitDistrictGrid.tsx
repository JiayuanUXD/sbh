import React from 'react'

import type { PublicCitySiteProfile } from '@/domain/city-site-profile/public-contract'

/**
 * OPT-038 城市招募页 · 商圈布局（Task 4）
 *
 * 设计依据：docs/SBH设计任务讨论/城市招募页.dc.html:197-222 与末尾 specRows
 *   - 「商圈布局网格」3 列 · gap 48/24 → 列宽 325.33（=(1024 − 2×24)/3）
 *   - 「商圈名 / 区位」24 / 600 · 17 / 400 --ink-2
 *   - 每格：行顶 1px --line hairline + padding-top 20
 * 样式全部在 styles/recruit.css 的 `.rc-districts*` / `.rc-district*`，本文件无内联样式。
 *
 * ── Server Component ──────────────────────────────────────────────────────
 * 无 'use client'、无 hook、**不读 Payload**：只消费 `PublicCitySiteProfile`
 * 已经映射好的 `featuredRegions`。两个消费面（`/city-partner` 与 `/[city]`）
 * 共用本组件，差异由 props 承载，Task 5 接线。
 *
 * ── 自带 `.rc-section` + `.rc-container` ──────────────────────────────────
 * 与 RecruitHero 同形、与 RecruitValueProps 相反：商圈段**独占一整条白底带**
 * （稿子:198 `background:var(--bg)`，稿子的 --bg 是白 → 本项目 `.rc-section` 默认底色，
 * 颜色映射见 recruit.css 文件头），不与任何别的段共享背景带，所以带子由自己出。
 * 价值点那个之所以不自带，是因为它与表单卡共用同一条灰底带。
 *
 * ── ⚠️「首批上线 / 筹备中」状态标签：本批不做，六个商圈统一渲染 ────────────
 * 稿子给每个商圈配了一个状态 pill（renderVals().districts 的 `status` / `live` / `wait`）。
 * 按字段可得性三层判定：
 *   ① 手里的 DTO：`featuredRegions` 只有 id/slug/name/type（+ 本任务补的
 *      parentName/description），没有任何招募位状态；
 *   ② 缺映射：`Locations` 上也没有可映射的招募位状态字段；
 *   ③ collection：`Locations.status` 是 active/disabled 的**启用开关**，
 *      `CitySiteProfiles.serviceStatus` 是 live/coming-soon 的**城市级**服务状态——
 *      **整条链路没有「这个商圈的招募位处在哪个批次」这个维度**。
 * 所以「挑前三个标成首批上线」= 凭排序位置编造一个数据里不存在的承诺。不做。
 * 恢复它的前置条件写在工作项 §7.1（在 Locations 或城市 profile 上新增招募位状态
 * 枚举字段，含迁移 + 后台可填 + mapper 映射），与 Task 2 去掉「第 N 城」同型。
 *
 * 同步后果：引导语里那句「首批三个商圈开放独家席位，其余为筹备中」也必须改掉，
 * 否则文案承诺了界面不做的区分（见下方 recruitDistrictLead）。
 *
 * ── 商圈卡**不带链接** ────────────────────────────────────────────────────
 * 稿子的商圈格本身就没有链接，且前台没有「单个商圈」这种路由
 * （`(frontend)/[city]/` 下只有 buildings / listings / sale），唯一能指过去的
 * 是按商圈筛过的列表页——而本页面向的是**尚未开通**的城市，那种链接点进去
 * 只会是一页空结果。所以这里一条链接都不渲染：
 * 「高基数常驻链接要 prefetch={false}」那条判据（锚点 ui/Breadcrumb.tsx，
 * 问的是这一页渲染出几条互不相同的 URL）在本段**根本不触发**，
 * 不是「触发了但我们决定不加」。
 */

/** 组件只读这几个字段；类型直接取自 DTO，避免在这里另立一套结构定义。 */
export type RecruitDistrict = PublicCitySiteProfile['featuredRegions'][number]

/** h2：「{城市}重点服务商圈布局」（稿子:203）。 */
export function recruitDistrictHeading(cityName: string): string {
  return `${cityName}重点服务商圈布局`
}

/**
 * 引导语（稿子:204 的**改写版**）。
 *
 * 稿子原文：「即将覆盖{城市}核心商务区与高新产业聚集地。**首批三个商圈开放独家席位，
 * 其余为筹备中。**」——后半句承诺了一个界面根本不做的区分（状态标签本批不做，
 * 见文件头），而且「首批三个」是按列表位置数出来的，数据里没有任何依据。
 *
 * 改成：「…… 下列商圈均在规划范围内，暂不区分开放批次。」
 * 后半句说的是本页真实成立的事——六个商圈统一渲染、平台侧确实没有批次维度，
 * 且申请表本身也不按商圈收字段。这是「改成展示真实拥有的东西并相应改标签」，
 * 不是把承诺换个说法留着。
 */
export function recruitDistrictLead(cityName: string): string {
  return `即将覆盖${cityName}核心商务区与高新产业聚集地。下列商圈均在规划范围内，暂不区分开放批次。`
}

/**
 * 区位副标：「上级行政区 · 区域介绍」（稿子:216「上城区 · 金融总部核心区」）。
 *
 * 两段都可能缺：
 *   - `parentName` 在区域本身就是行政区时恒为 null（它的上级就是这座城市，
 *     见 public-contract 的字段注释）；
 *   - `description` 是后台选填的「区域介绍」。
 * 缺一段就只出另一段，两段都缺返回 null（调用方整行不渲染，见下）。
 *
 * 这里是全站唯一一处拼这个「·」的地方：两个消费面共用本组件，
 * 拼接不下放给调用方，避免同一条展示口径出现第二个落点。
 */
function formatLocality(district: RecruitDistrict): string | null {
  const parts = [district.parentName, district.description].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )
  return parts.length > 0 ? parts.join(' · ') : null
}

type RecruitDistrictGridProps = Readonly<{
  /** 城市显示名，用于 h2 与引导语；两处文案由本组件推导，调用方不再各抄一份。 */
  cityName: string
  /** 精选区域，直接传 `profile.featuredRegions`。空数组则整段不渲染。 */
  districts: readonly RecruitDistrict[]
  /** h2 的 id，供 section 的 `aria-labelledby` 指向；不传则两者都不加。 */
  titleId?: string
}>

export default function RecruitDistrictGrid({
  cityName,
  districts,
  titleId,
}: RecruitDistrictGridProps) {
  // 空态**整段不渲染**：没有精选区域时，剩下的只有一个标题加一句「即将覆盖……」，
  // 是标准的空货架。这里也没有「诚实空态」可言——商圈列表不是用户发起的查询，
  // 给不出「换个条件再试」这类下一步动作，留着只会占位。
  if (districts.length === 0) return null

  return (
    <section className="rc-section" {...(titleId ? { 'aria-labelledby': titleId } : {})}>
      <div className="rc-container">
        {/* h2 挂 `.hm-h2`（home.css:26 的 40/600/1.10，且已带 ≤767 收 32 的移动档）：
            稿子:203 与首页 section 标题逐项同值，重抄一遍就是第二个事实源。
            这是该基元的第三个消费方（首页 7 处、价值点主栏、本段）；
            它住在 home.css 里带 `hm-` 前缀属已知命名瑕疵，处置见 recruit.css。 */}
        <h2 className="hm-h2" {...(titleId ? { id: titleId } : {})}>
          {recruitDistrictHeading(cityName)}
        </h2>
        <p className="rc-districts__lead rc-measure">{recruitDistrictLead(cityName)}</p>
        {/* <ul> 而非一堆 <div>：这是一份并列的商圈清单，读屏能报出条目数。
            顺序不承载语义（不是 01/02/03 那种序列），所以是 ul 不是 ol。 */}
        <ul className="rc-district-grid">
          {districts.map((district) => {
            const locality = formatLocality(district)
            return (
              <li className="rc-district" key={district.id}>
                <span className="rc-district__name">{district.name}</span>
                {/* 区位缺失时整行不渲染，**不写「—」**：那条「缺失显示 —、不显示 0」
                    的约束是数字口径（与 tabular-nums 并列写的），用来防「0 套」这类
                    看起来是真值的谎。区位是散文字段，一格破折号既不是值也不是空，
                    六个商圈都没填时会变成一整排破折号——比不渲染更像空货架。
                    卡片按网格行顶对齐，少一行不会让版式歪。 */}
                {locality ? <span className="rc-district__area">{locality}</span> : null}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
