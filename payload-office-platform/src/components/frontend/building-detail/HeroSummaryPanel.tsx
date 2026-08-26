import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import DetailPanel from '@/components/frontend/detail/DetailPanel'
import { formatCompletionYear } from '@/components/frontend/detail/fact-lookup'
import SpecTable, { type SpecRow } from '@/components/frontend/detail/SpecTable'
import InquiryModal from '@/components/frontend/InquiryModal'
import { priceUnitLabel } from '@/lib/frontend/format'
import {
  aggregateAreaRange,
  findLowestPrice,
  formatAreaRange,
} from './supply-summary'
import type {
  BuildingDetailViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 楼盘详情核心区右侧「信息面板」（OPT-037 Task 6）：起价大字 + 免责声明 +
 * 面积/套数双统计 + 关键参数行 + 顾问 CTA。外层白底面板复用共享的
 * `DetailPanel variant="side"`（.dt-panel--side，padding 32）——此前是本
 * 组件自带一份 `.hero-summary` 面板底色/边框/圆角，现收敛到与「房源
 * 概况面板」「决策卡」同一个面板基元，不再各写一份「白底卡片」。
 * 关键参数行改用共享的 `SpecTable`（原先是手写 `<dl>`），行高/分隔线与
 * comp 的 coreRows（min-height 42、padding 10 0）几乎一致，属于「同一种
 * 两列键值行」，不再另起一套 dt/dd 布局。
 *
 * 未照抄 comp 字面的 coreRows（单价区间/面积区间/可即刻入驻/业务组）：
 * comp 的「单价区间」要求跨业务组（租赁/出售/联合办公）合并出一个价格
 * 区间，但不同业务组的计价单位不可通约（元/㎡/天 的租金 与 元/㎡ 的
 * 售价没有共同分母）——与本工作项 §2.3 取消「租金账」tab 的理由同源
 * （见 progress.md）。现有实现按「跨组最低价格挑一个可比单位」取「起价」，
 * 是这个真实约束下的诚实简化，不因贴合 comp 版式而重新引入同一个坑。
 * 参数行从 factGroups 按标签优先抽取，真实数据缺字段时静默省略——这是
 * 一份「候选标签，挑最多 N 个命中的」自适应清单，不是固定行清单，
 * 所以不适用 SpecTable「行不因值缺失而隐藏」的约定（那条约定针对的是
 * 固定 schema 的行，这里从一开始就只构造「找到的」条目）。
 */

const HERO_FACT_LABELS = ['建筑面积', '竣工时间', '物业公司', '物业费', '层高', '总楼层'] as const
const MAX_HERO_FACTS = 5

type HeroSummaryPanelProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  serviceSchedule?: ServiceSchedule
}>

function pickHeroFacts(building: BuildingDetailViewModel): { label: string; value: string }[] {
  const allFacts = building.factGroups.flatMap((group) => group.facts)
  const picked: { label: string; value: string }[] = []
  for (const wanted of HERO_FACT_LABELS) {
    if (picked.length >= MAX_HERO_FACTS) break
    const fact = allFacts.find((item) => item.label.includes(wanted))
    if (!fact || !fact.value || picked.some((item) => item.label === fact.label)) continue
    // 「竣工时间」事实值是 ISO 日期字符串（mapBuildingFactGroups 未做展示
    // 格式化），与 BuildingSpecPanel 的「竣工年份」共用同一个年份提取
    // （见 fact-lookup.ts），不各转一次；解析失败（非预期格式）时退回原值，
    // 不因格式化失败让这个关键参数整条消失。
    const value = fact.label === '竣工时间' ? (formatCompletionYear(fact.value, fact.estimated) ?? fact.value) : fact.value
    picked.push({ label: fact.label, value })
  }
  return picked
}

export default function HeroSummaryPanel({
  building,
  supply,
  serviceSchedule,
}: HeroSummaryPanelProps) {
  const lowest = findLowestPrice(supply.availableGroups)
  const areaRange = aggregateAreaRange(supply.availableGroups)
  const hasSupply = supply.totalEffectiveListings > 0
  const heroFacts = pickHeroFacts(building)

  // 地址/地铁 + 命中的关键参数——只构造"找到的"条目，不是固定行清单，
  // 故不适用 SpecTable「缺失也保留该行」的约定（见文件头注释）。
  const infoRows: SpecRow[] = []
  if (building.address) infoRows.push({ label: '地址', value: building.address })
  if (building.nearestMetro) infoRows.push({ label: '地铁', value: building.nearestMetro.name })
  for (const fact of heroFacts) infoRows.push({ label: fact.label, value: fact.value })

  return (
    <aside aria-label="楼盘决策信息">
      <DetailPanel variant="side" className="hero-summary">
        <p className="hero-summary__price-row">
          {lowest ? (
            <>
              <span className="sf-num hero-summary__price">{lowest.min}</span>
              <span className="hero-summary__price-unit">
                {priceUnitLabel(lowest.displayUnit)} 起
              </span>
            </>
          ) : (
            <span className="sf-num hero-summary__price hero-summary__price--na">价格面议</span>
          )}
        </p>
        <p className="hero-summary__disclaimer">页面价格为公开挂牌价，实际价格以顾问报价为准</p>

        <div className="hero-summary__stats">
          <div className="hero-summary__stat">
            <strong className="sf-num">{areaRange ? formatAreaRange(areaRange) : '—'}</strong>
            <span>可租面积</span>
          </div>
          <div className="hero-summary__stat">
            <strong className="sf-num">{supply.totalEffectiveListings} 套</strong>
            <span>当前有效供给</span>
          </div>
        </div>

        {infoRows.length > 0 && <SpecTable rows={infoRows} />}

        <AdvisorCard
          cta={
            <InquiryModal
              pageType="building"
              targetBuildingSlug={building.slug}
              targetSummary={building.name}
              triggerLabel={hasSupply ? '询价 / 预约看房' : '登记找房需求'}
              sourceSection="hero"
              serviceSchedule={serviceSchedule}
            />
          }
        />
      </DetailPanel>
    </aside>
  )
}
