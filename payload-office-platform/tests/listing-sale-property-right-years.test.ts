/**
 * 出售专属必填「产权年限」的取值路径（同族假阴性收口）
 *
 * `propertyRightYears` 在 `Listings.ts` 里嵌在 `saleTerms` group 内，真实路径是
 * `listing.saleTerms.propertyRightYears`。但多处快照/计分照 `doc.propertyRightYears`
 * 这个**顶层**路径读——顶层没有这个字段，读出来恒 undefined，于是每一套出售房源都：
 *
 *   - 在审核队列里恒显示缺「产权年限」、完整度分数虚低（`toCompletenessSnapshot` 漏传）；
 *   - 管理员保存即发布后的「已保存但还缺 X」提示恒多报一项（`buildListingSnapshot` 读错路径）；
 *   - 在运营看板上结构性白丢 5%，正是 `computeListingCompleteness` 里那段注释想避免的事。
 *
 * 与刚修掉的商户项假阳性同族：队列/快照没如实映射房源文档。
 *
 * 这里除了按入口各锁一遍「填了产权年限 → 缺失清单不含 propertyRightYears」，还对
 * `getSubmitRequiredFields` 的租售两个口径做**全键覆盖**：逐个把必填项挖空，断言队列
 * 快照如实把它报成缺失。漏传任何一个键都会让对应用例变红——这次漏的是产权年限，
 * 下次漏别的也一样接得住。
 */

import { describe, expect, it } from 'vitest'

import {
  COMPLETENESS_WEIGHTS,
  computeListingCompleteness,
} from '@/domain/analytics/queries/listing-completeness'
import { toCompletenessSnapshot } from '@/components/admin/listing-review-queue-row'
import {
  checkListingCompleteness,
  getSubmitRequiredFields,
} from '@/domain/review/listing-completeness'
import { buildListingSnapshot } from '@/domain/review/review-transition'
import type { Listing } from '@/payload-types'

/** 最小 Lexical 富文本值：必须带至少一个子节点，否则运营看板的 `hasRichTextContent` 判空。 */
const RICH_TEXT = {
  root: {
    type: 'root',
    direction: null,
    children: [{ type: 'paragraph', version: 1, children: [{ text: '甲级写字楼，视野开阔。' }] }],
  },
} as unknown

/** 一套样样齐全、可直接提交审核的出售房源（产权年限按真实路径嵌在 saleTerms 里）。 */
function saleListing(): Listing {
  return {
    id: 42,
    title: '国贸三期 3801',
    slug: 'guomao-3-3801',
    listingType: 'traditional-office',
    building: 12,
    businessType: 'sale',
    decorationStatus: 'fully_fitted',
    price: { amount: 45000, currency: 'CNY', period: 'one-time', unit: 'sqm' },
    area: 320.5,
    floor: '38',
    saleTerms: { propertyRightYears: '70' },
    description: RICH_TEXT,
    contactBroker: 7,
    merchant: 3,
    coverImage: 9,
    gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
    highlights: [{ text: '地铁上盖' }],
    version: 5,
    updatedAt: '2026-08-19T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  } as Listing
}

/** 同上，租赁口径（租期三件套齐全、无 saleTerms）。 */
function leaseListing(): Listing {
  const { saleTerms: _saleTerms, ...rest } = saleListing()
  return {
    ...rest,
    businessType: 'lease',
    price: { amount: 8.5, currency: 'CNY', period: 'month', unit: 'sqm' },
    minimumLeaseMonths: 12,
    paymentTerms: '押二付三',
    availableFrom: '2026-09-01T00:00:00.000Z',
  } as Listing
}

/** 把某个必填项挖空的最小改动（键 = 完整度字段键）。 */
const BLANK_FOR_FIELD: Record<string, Partial<Listing>> = {
  title: { title: '' },
  building: { building: undefined as never },
  listingType: { listingType: undefined as never },
  businessType: { businessType: null },
  decorationStatus: { decorationStatus: null },
  price: { price: undefined },
  area: { area: null },
  floor: { floor: null },
  description: { description: null },
  contactBroker: { contactBroker: null },
  gallery: { gallery: [] },
  merchant: { merchant: null },
  minimumLeaseMonths: { minimumLeaseMonths: null },
  paymentTerms: { paymentTerms: null },
  availableFrom: { availableFrom: null },
  propertyRightYears: { saleTerms: {} },
}

const queueMissing = (listing: Listing) =>
  checkListingCompleteness(toCompletenessSnapshot(listing), 'submit').missing.map((m) => m.field)

describe('审核队列完整度快照（toCompletenessSnapshot）', () => {
  it('出售房源填了产权年限 → 缺失清单不含 propertyRightYears', () => {
    expect(queueMissing(saleListing())).toEqual([])
  })

  it('出售房源没填产权年限 → 仍如实报缺（不是靠恒真放过）', () => {
    expect(queueMissing({ ...saleListing(), saleTerms: {} })).toEqual(['propertyRightYears'])
  })

  it('租赁房源不因缺 saleTerms 被误报缺产权年限', () => {
    expect(queueMissing(leaseListing())).toEqual([])
  })

  // 全键覆盖：快照少传任何一个必填键，对应用例都会红。
  describe.each([
    { mode: 'sale' as const, listing: saleListing },
    { mode: 'lease' as const, listing: leaseListing },
  ])('$mode 口径必填项逐个挖空', ({ mode, listing }) => {
    it.each(getSubmitRequiredFields(mode))('挖空 %s 后如实报缺', (field) => {
      const blank = BLANK_FOR_FIELD[field]
      expect(blank, `缺少 ${field} 的挖空写法`).toBeDefined()
      expect(queueMissing({ ...listing(), ...blank })).toContain(field)
    })
  })
})

describe('提交审核快照（buildListingSnapshot）', () => {
  it('从 saleTerms 里读出产权年限', () => {
    expect(buildListingSnapshot(saleListing() as never).propertyRightYears).toBe('70')
  })

  it('出售房源填了产权年限 → 完整度不再恒报缺产权年限', () => {
    const snapshot = buildListingSnapshot(saleListing() as never)
    const result = checkListingCompleteness(
      { ...snapshot, hasValidMerchantRelation: snapshot.merchant != null },
      'submit',
    )
    expect(result.missing.map((m) => m.field)).toEqual([])
  })
})

describe('运营看板完整度评分（computeListingCompleteness）', () => {
  it('出售房源填了产权年限即拿满分，不因取值路径错而白丢 5%', () => {
    expect(computeListingCompleteness(saleListing() as never).score).toBeCloseTo(1, 3)
  })

  it('出售房源没填产权年限 → 恰好扣掉租售专属项的权重', () => {
    expect(
      computeListingCompleteness({ ...saleListing(), saleTerms: {} } as never).score,
    ).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.businessTypeSpecific, 3)
  })
})
