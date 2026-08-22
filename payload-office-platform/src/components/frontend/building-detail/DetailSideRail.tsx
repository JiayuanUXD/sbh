import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import type { BuildingDetailViewModel } from '@/domain/public-catalog'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 在租房源区下方的「找房需求登记」通栏留资带。
 *
 * 本组件曾经是四张卡的卡片带，OPT-037 Task 11 / 11b 分两次收敛成一张卡：
 *
 *   1. Task 11 摘掉「热门楼盘」——它与本页 `#related`「同商圈楼盘」、
 *      `NearbyBuildingsStrip`「周边楼盘」读的是同一份 `relatedBuildings`，
 *      Task 10 在 `test0814` 实测到同一个楼盘在一页里出现三次；
 *   2. Task 11b 摘掉「楼盘摘要」与「免费咨询」——这两张与核心区的
 *      `HeroSummaryPanel` 是**同一份内容的第二次呈现**：摘要卡的起价走同一个
 *      `findLowestPrice(supply.availableGroups)`、供给套数走同一个
 *      `supply.totalEffectiveListings`、楼盘名还与 `.dt-titlebar__title` 的
 *      h1 重复；「免费咨询」更是把 `AdvisorCard` + `InquiryModal` 原样再渲染
 *      一遍，有供给时连触发文案都一字不差。
 *
 * 于是本组件只剩**唯一独有**的那一个产品面：留资（「登记需求，顾问回电」）。
 * 相应地它也不再需要 `supply` / `relatedBuildings` / `citySlug` 任何一个入参——
 * 一张纯留资带只关心「往哪个楼盘登记」和「顾问服务时段」。
 *
 * **埋点不受影响**：摘掉的那个 `AdvisorCard` 用的是 `sourceSection="sticky-card"`，
 * 而该取值在本页仍有两个承载元素——`AnchorNavBar` 顶部吸附条的「预约看房」与
 * 本组件的「登记需求，顾问回电」。页面上 `hero` / `sticky-card` / `mobile-bar`
 * 三个 source 一个都没丢（实测清单见 `task11b-after.json` 的 `inquiryAudit`）。
 *
 * 版式：一张卡就不该再挂在多列网格上（会在行尾留空轨），改成横贯容器整宽的
 * 一条带，内部「文案左 / CTA 右」。取值见 detail.css 的 `.dt-page .detail-side-rail`。
 */
type DetailSideRailProps = Readonly<{
  building: BuildingDetailViewModel
  serviceSchedule?: ServiceSchedule
}>

export default function DetailSideRail({ building, serviceSchedule }: DetailSideRailProps) {
  return (
    <aside className="detail-side-rail" aria-label="需求登记">
      <section className="detail-side-rail__card">
        <div className="detail-side-rail__band-copy">
          <h3>找房需求登记</h3>
          <p className="detail-side-rail__muted">留下需求，顾问按服务时段回电推荐匹配空间</p>
        </div>
        <InquiryModal
          pageType="building"
          targetBuildingSlug={building.slug}
          targetSummary={building.name}
          triggerLabel="登记需求，顾问回电"
          sourceSection="sticky-card"
          serviceSchedule={serviceSchedule}
        />
      </section>
    </aside>
  )
}
