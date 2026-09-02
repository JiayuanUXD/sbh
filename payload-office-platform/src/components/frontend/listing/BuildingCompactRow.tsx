import Link from 'next/link'
import { listAnalyticsAttrs, type ListResultAnalytics } from '@/components/frontend/listing/list-analytics'
import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import { completionYear } from '@/lib/frontend/format'
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
 * 历史注记：本组件早先版本曾因 BuildingSummaryViewModel 缺「标准层面积」字段，把
 * 资料行换成 [等级, 所在区域, 竣工年份]。该判断查得不够远——字段其实一直存在，只是
 * 在 Payload collection（Buildings.developerAndScale.typicalFloorArea）和详情页
 * mapper（getBuildingDetail 的 fact('标准层面积', scale.typicalFloorArea)）里，
 * 没进 BuildingSummaryViewModel 这一层 DTO。域层已把它加进 mapBuildingSummary，
 * 资料行改回设计稿原版：「等级 · 竣工年份 · 标准层 xxx ㎡」。
 *
 * 守护不变量：
 *   - Server Component，只消费 BuildingSummaryViewModel DTO，不接收 Payload 文档；
 *   - 缺封面：48×48 缩略图占位色 #a1a1a6（比在租卡 .sf-media 的 #8e8e93 更浅——两个
 *     占位灰是设计稿既有例外，见 cross-batch-design-decisions.md「允许不一致的项」同类
 *     处置，浅灰用于「暂无在租」组，与在租卡区分但不抢视觉）；
 *   - 等级 / 竣工年份 / 标准层面积任一缺失：该段跳过，不渲染空的「·」分隔；全部缺失时
 *     资料行整行省略，不留空行；
 *   - 楼名超长：单行省略号，不换行。
 *   - 「上新通知我」是纯展示 pill（本任务只做视觉，订阅能力另行接线），不是可独立聚焦的
 *     控件——避免链接内嵌套交互元素。
 */

/**
 * 竣工年份文案；非法/缺失 ISO 日期返回 null。
 * 解析与合法性判定走共享的 `completionYear()`（`lib/frontend/format.ts`）——
 * 本处原先自带一份 `Date.parse` 实现，注释里已经写着「同 building-search.ts
 * completionYearOf 的口径」，即**已知重复**；终审时又发现了第三份。现在三处
 * 共用同一个解析器，只有展示后缀各自保留（本处是 "2013年竣工"）。
 */
function completionYearLabel(iso: string | undefined): string | null {
  const year = completionYear(iso)
  return year == null ? null : `${year}年竣工`
}

/** 标准层面积文案；与 BuildingResultCard 的 formatLeasableArea 同一惯例：取整 + 千分位。 */
function typicalFloorAreaLabel(area: number | undefined): string | null {
  if (area == null || area <= 0) return null
  return `标准层 ${Math.round(area).toLocaleString('en-US')} ㎡`
}

export default function BuildingCompactRow({ building, citySlug, analytics }: Readonly<{
  building: BuildingSummaryViewModel
  citySlug?: string
  /** 列表页埋点上下文；不传则不产生点击事件 */
  analytics?: ListResultAnalytics
}>) {
  const { coverImage, grade, completionDate, typicalFloorArea, name, slug } = building
  const gradeLabel = getBuildingGradeLabel(grade)
  const metaText = [gradeLabel, completionYearLabel(completionDate), typicalFloorAreaLabel(typicalFloorArea)]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  return (
    <Link
      href={citySlug ? `/${citySlug}/buildings/${slug}` : `/buildings/${slug}`}
      // prefetch={false}：与 `BuildingResultCard` 指向同一类 URL、同一个页面，三条件
      // 同样并列成立。而且本行**比在租卡更该关**：行高只有 64（在租卡约 182），同一屏
      // 能进视口的条数是在租卡的三倍左右，①高基数这一条在它身上只会更强。
      // 「暂无在租」不等于「用户不会点」——设计上它就是可查的目录内容（见上方文档
      // 注释），所以这里关的是**自动**预取，hover 触发的预取与点击导航都不受影响。
      prefetch={false}
      {...listAnalyticsAttrs(analytics)}
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
