import { describe, expect, it } from 'vitest'

import { toCompletenessSnapshot } from '@/components/admin/listing-review-queue-row'
import { checkListingCompleteness } from '@/domain/review/listing-completeness'
import type { Listing } from '@/payload-types'

/**
 * 审核队列完整度：商户项必须读房源真实的 `merchant`，不能恒真。
 *
 * 背景：队列曾把 `hasValidMerchantRelation` 硬编码为 true，理由是「提交时已校验」
 * ——但提交 endpoint（listing-review-decision-endpoint.ts）从头到尾没调过
 * `checkListingCompleteness`，只校验状态机；`merchant` 字段也没有锁定机制。
 * 于是「merchant 为空 + reviewStatus=pending」在生产是可达状态，审核台却显示
 * 商户项已满足、分数虚高——生产事故 #2464（后台信号全绿、前台查无此房）的重演。
 */

/** 只关心商户项，其余字段留空即可（别的缺失项不影响 merchant 的断言）。 */
function listingWithMerchant(merchant: Listing['merchant']): Listing {
  return { id: 1, merchant } as unknown as Listing
}

function missingFields(merchant: Listing['merchant']): string[] {
  const result = checkListingCompleteness(toCompletenessSnapshot(listingWithMerchant(merchant)), 'submit')
  return result.missing.map((m) => m.field)
}

describe('审核队列完整度快照的商户判定', () => {
  it('房源没有供给商户时，缺失清单包含供给商户', () => {
    const result = checkListingCompleteness(toCompletenessSnapshot(listingWithMerchant(null)), 'submit')
    const merchantItem = result.missing.find((m) => m.field === 'merchant')

    expect(merchantItem).toBeDefined()
    expect(merchantItem?.label).toBe('供给商户')
  })

  it('merchant 为裸 id 时，缺失清单不含供给商户', () => {
    expect(missingFields(42)).not.toContain('merchant')
  })

  it('merchant 为 populate 对象时，缺失清单不含供给商户', () => {
    expect(missingFields({ id: 42, name: '某商户' } as unknown as Listing['merchant'])).not.toContain(
      'merchant',
    )
  })

  it('选了商户的房源完整度分数高于没选的', () => {
    const withMerchant = checkListingCompleteness(
      toCompletenessSnapshot(listingWithMerchant(42)),
      'submit',
    )
    const without = checkListingCompleteness(
      toCompletenessSnapshot(listingWithMerchant(null)),
      'submit',
    )

    expect(withMerchant.score).toBeGreaterThan(without.score)
  })
})
