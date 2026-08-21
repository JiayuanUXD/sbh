import React, { type ReactNode } from 'react'
import DetailPanel from './DetailPanel'
import {
  estimateRowTotal,
  formatGroupTotal,
} from '@/components/frontend/building-detail/supply-summary'
import type { ListingDetailViewModel } from '@/domain/public-catalog'
import { formatArea, formatPublishedDate } from '@/lib/frontend/format'
import { splitPriceText } from '@/lib/frontend/listing-display'

/**
 * 房源详情决策卡（OPT-037 Task 9 接线）
 *
 * 设计依据：`docs/SBH设计任务讨论/房源详情.dc.html`「决策栏」+ specRows
 * 「决策卡 372 宽 · padding 32 · 月租 40/600 · CTA 48 高」「核验行 15px 勾图标 +
 * 13/400 标签 + 13/500 时间」「ISO 时间戳去处：只进 title 属性，不渲染给用户」。
 *
 * 粘附行为不在本文件：`.dt-decision` 的 `sticky top 116` 与粘附区间由
 * detail.css + `.dt-core` 的 grid 结构决定（见 detail.css「决策卡 + 吸附询价条」
 * 小节），本组件只负责卡内内容与那个钉在 `grid-column:2 / grid-row:1` 的容器。
 *
 * 为什么把它从 CityListingDetailView 里抽出来：Task 9 的要求是把编排层退化成
 * 编排层。价格摘要（单价/月租折算/面积）与核验行是两段有分支的展示逻辑，留在
 * 页面文件里会让"页面顺序"被 40 行卡片细节淹没；抽出后 dev-story 预览页
 * （opt037）也能直接复用同一份卡片，不再各写一份 `.dt-decision__*` 手工 markup
 * （Task 4 时预览页里那份已经是第二处，本次一并收敛）。
 *
 * comp 里决策卡还有「电话咨询」次要按钮与「顾问姓名/带看次数」两项，本组件
 * 都不渲染，理由与 Task 4 的记录一致且**逐条复核过仍然成立**：
 *   - 电话咨询：仓库里没有任何可公开展示的号码字段（site-config.ts 与全部
 *     *Phone* 字段只有用户提交的联系电话），而 AdvisorCard.tsx 文件头明令不得
 *     展示个人顾问手机号——两条路都不通，不是漏做；
 *   - 顾问姓名/带看次数：`AdvisorCard` 是平台虚拟身份（不含可识别个人信息），
 *     带看次数域层没有该字段。顾问区改为直接嵌 `AdvisorCard`（由调用方传入，
 *     因为它是要读 Payload global 的 async 服务端组件，本组件只消费 DTO）。
 */

type ListingPriceInput = Pick<
  ListingDetailViewModel,
  'price' | 'area' | 'seats' | 'businessType'
>

export type ListingPriceDigest = Readonly<{
  /** 价格标签：租赁「租金单价」/ 出售「售价」 */
  label: string
  /** 价格数值段（如 "8.5"）；null 表示这套房源没有公开价格 */
  value: string | null
  /** 价格单位段（如 "元/㎡/天"）；随 value 一起来自同一个 PriceViewModel.text */
  unit: string | null
  /** 无价格时的既有展示文案（与 `.detail__mobile-bar` 同一口径，不新造第二套） */
  fallbackText: string
  /** 「月租 X 元/月 · 1,240 ㎡」这类次要摘要；两项都不可达时为 null（整行不渲染） */
  summaryText: string | null
}>

const PRICE_FALLBACK_TEXT = '价格面议'

/**
 * 决策卡与吸附询价条**共用同一份价格摘要**——两者是同一个询价入口在滚动过程中的
 * 两种呈现形态（见 StickyInquiryBar 文件头），价格文案分叉就是两个事实源。
 * 页面只调用一次，把结果同时喂给两处。
 *
 * 三段取值全部复用既有基元，本文件不新增任何价格计算或格式化：
 *   - 数值/单位切分：`splitPriceText`（OPT-036 建立，PriceViewModel.text 是
 *     domain 侧拼好的唯一事实源，这里只切不算）；
 *   - 月租/总价折算：`estimateRowTotal` + `formatGroupTotal`（楼盘供给密度表
 *     Task 7 建立）。租赁按 comp 的「月租 元/月」、出售按「总价 万元」，与供给
 *     表同一口径同一函数——按天计价 × 30 天折算的那条规则只存在于
 *     `estimateRowTotal` 里，本文件不复制。折算所需维度缺失（无面积 / 工位计价
 *     但无工位数 / 周期不可折算）时返回 null，摘要里就没有这一段，不填 0。
 *   - 面积：`formatArea`。注意它对 null 返回「面议」而不是空，所以这里先判空，
 *     不让「面议」以面积的身份混进摘要。
 */
export function buildListingPriceDigest(listing: ListingPriceInput): ListingPriceDigest {
  const split = splitPriceText(listing.price)
  const total = estimateRowTotal(listing.price, {
    area: listing.area,
    seats: listing.seats,
  })
  const isSale = listing.businessType === 'sale'
  const summaryParts: string[] = []
  if (total != null) {
    summaryParts.push(
      isSale
        ? `总价 ${formatGroupTotal(total, 'sale')} 万元`
        : `月租 ${formatGroupTotal(total, 'lease')} 元/月`,
    )
  }
  if (listing.area != null) summaryParts.push(formatArea(listing.area))

  return {
    label: isSale ? '售价' : '租金单价',
    value: split?.value ?? null,
    unit: split && split.unit !== '' ? split.unit : null,
    fallbackText: PRICE_FALLBACK_TEXT,
    summaryText: summaryParts.length > 0 ? summaryParts.join(' · ') : null,
  }
}

/** 核验行的勾图标（comp：15px 圆 + 勾，零色相）。 */
function VerifyCheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" className="dt-decision__verify-icon">
      <circle cx="7.5" cy="7.5" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.4 7.7l2.1 2.1 4.1-4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ListingDecisionCard({
  digest,
  verification,
  cta,
  advisor,
}: Readonly<{
  digest: ListingPriceDigest
  /** 信息 / 价格核验时间；两项都缺时整块核验区不渲染，不留空的分隔线 */
  verification: ListingDetailViewModel['verification']
  /** 询价 / 预约看房触发器（InquiryModal），与吸附条同一份目标房源 props */
  cta: ReactNode
  /**
   * 顾问区（`AdvisorCard`）。它是要读 Payload global 的 async 服务端组件，
   * 本组件保持"只消费 DTO"，故由调用方渲染后传入；预览页不传即整块不出现。
   */
  advisor?: ReactNode
}>) {
  const verifyRows = [
    { key: 'info', label: '信息核验', iso: verification.verifiedAt },
    { key: 'price', label: '价格核验', iso: verification.priceVerifiedAt },
  ].filter((row): row is { key: string; label: string; iso: string } => row.iso != null)

  return (
    <div className="dt-decision">
      <DetailPanel variant="side">
        <span className="dt-decision__label">{digest.label}</span>
        <div className="dt-decision__price-row">
          {digest.value != null ? (
            <>
              <span className="sf-num dt-decision__price-num">{digest.value}</span>
              {digest.unit && <span className="dt-decision__price-unit">{digest.unit}</span>}
            </>
          ) : (
            // 无价格不渲染 0、也不留空行：直接用既有的「价格面议」文案，字号降一档
            // （与 HeroSummaryPanel 的 .hero-summary__price--na 同一处理方式）。
            <span className="sf-num dt-decision__price-num dt-decision__price-num--na">
              {digest.fallbackText}
            </span>
          )}
        </div>
        {digest.summaryText && <p className="dt-decision__summary">{digest.summaryText}</p>}

        {verifyRows.length > 0 && (
          <div className="dt-decision__verify">
            {verifyRows.map((row) => (
              <div key={row.key} className="dt-decision__verify-row">
                <VerifyCheckIcon />
                <span className="dt-decision__verify-label">{row.label}</span>
                <span className="sf-num dt-decision__verify-when" title={row.iso}>
                  {formatPublishedDate(row.iso)}
                </span>
              </div>
            ))}
          </div>
        )}

        {cta}
        {advisor}
      </DetailPanel>
    </div>
  )
}
