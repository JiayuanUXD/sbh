import Link from 'next/link'
import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-036 暂无在租紧凑行（列表页「暂无在租」分组，方案 A）
 *
 * 设计依据：docs/SBH设计任务讨论/楼盘列表.dc.html 264-295 行（vacA 分支：
 * 「降权分组 + 换紧凑行」，是 vacancy 属性四个方案里唯一被选中的默认值）。
 *
 * 产品理由（别在这条组件上重演「灰底就是完成」）：楼盘不是房源的附属品——即使当前
 * 没有在租房源，楼盘本身仍是有价值的目录内容（用户可能就是冲着查这栋楼来的），所以不能
 * 隐藏。但它也不能和「真能租」的楼盘抢视觉。设计稿的答案是**降权靠密度差，不靠灰度**：
 * 在租卡约 182 高，本行只有 64 高，182:64 的高度反差本身就完成了降权，因此本组件
 * **不弱化楼名**——楼名维持 15/600 满墨色，只有次要资料行是 --ink-3。
 *
 * 已验证偏差：设计稿资料行原文案是「等级 · 竣工年份 · 标准层 xxx ㎡」，但
 * BuildingSummaryViewModel 没有「标准层面积」字段（leasableArea 语义是「在租面积」，
 * 对这批暂无在租的楼盘恒为 undefined，用它顶替标准层面积等于编造）。改用
 * [等级, 所在区域, 竣工年份] 三段——都是 contracts.ts 里真实存在的字段。
 *
 * 守护不变量：
 *   - Server Component，只消费 BuildingSummaryViewModel DTO，不接收 Payload 文档；
 *   - 缺封面：48×48 缩略图占位色 #a1a1a6（比在租卡 .sf-media 的 #8e8e93 更浅——两个
 *     占位灰是设计稿既有例外，见 cross-batch-design-decisions.md「允许不一致的项」同类
 *     处置，浅灰用于「暂无在租」组，与在租卡区分但不抢视觉）；
 *   - 等级 / 区域 / 竣工年份任一缺失：该段跳过，不渲染空的「·」分隔；全部缺失时资料行
 *     整行省略，不留空行；
 *   - 楼名超长：单行省略号，不换行。
 *   - 「上新通知我」是纯展示 pill（本任务只做视觉，订阅能力另行接线），不是可独立聚焦的
 *     控件——避免链接内嵌套交互元素。
 */

/** 竣工年份文案；非法/缺失 ISO 日期返回 null（同 building-search.ts completionYearOf 的口径）。 */
function completionYearLabel(iso: string | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return `${new Date(t).getFullYear()}年竣工`
}

export default function BuildingCompactRow({ building, citySlug }: Readonly<{
  building: BuildingSummaryViewModel
  citySlug?: string
}>) {
  const { coverImage, grade, district, completionDate, name, slug } = building
  const gradeLabel = getBuildingGradeLabel(grade)
  const metaText = [gradeLabel, district?.name, completionYearLabel(completionDate)]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  return (
    <Link
      href={citySlug ? `/${citySlug}/buildings/${slug}` : `/buildings/${slug}`}
      className="bd-row"
      aria-label={name}
    >
      <span className="bd-row__thumb">
        {coverImage ? (
          <img
            src={coverImage.src}
            alt={coverImage.alt || name}
            loading="lazy"
            decoding="async"
            width={coverImage.width}
            height={coverImage.height}
          />
        ) : null}
      </span>
      <span className="bd-row__body">
        <span className="bd-row__name">{name}</span>
        {metaText ? <span className="bd-row__meta sf-num">{metaText}</span> : null}
      </span>
      <span className="bd-row__notify">上新通知我</span>
    </Link>
  )
}
