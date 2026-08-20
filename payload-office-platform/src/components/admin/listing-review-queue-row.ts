import type { ListingCompletenessSnapshot, PriceSnapshot } from '@/domain/review/listing-completeness'
import type { Listing } from '@/payload-types'

/**
 * 审核队列行的纯映射助手（ListingReviewQueue.tsx 的服务端取数之外的部分）。
 *
 * 拆出来是为了可测：`vitest.config.ts` 只收 `tests/**\/*.test.ts`，留在 .tsx 里
 * 就只能写「读源码文本断言」这类假测试，锁不住真实行为。
 */

/** 关系值归一为数值 ID（number | populated 对象 | null）。 */
export function relationId(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number') return id
  }
  return null
}

/** 房源价格组归一为完整度校验用的 PriceSnapshot（null → undefined）。 */
export function toPriceSnapshot(
  price: Listing['price'] | null | undefined,
): PriceSnapshot | undefined {
  if (!price) return undefined
  return {
    amount: price.amount ?? undefined,
    currency: price.currency ?? undefined,
    period: price.period ?? undefined,
    unit: price.unit ?? undefined,
  }
}

/** 队列行的完整度入参：已解析（depth≥1）房源文档 → 完整度快照。 */
export function toCompletenessSnapshot(listing: Listing): ListingCompletenessSnapshot {
  return {
    title: listing.title,
    slug: listing.slug,
    listingType: listing.listingType,
    building: listing.building,
    businessType: listing.businessType,
    decorationStatus: listing.decorationStatus,
    price: toPriceSnapshot(listing.price),
    area: listing.area,
    floor: listing.floor,
    minimumLeaseMonths: listing.minimumLeaseMonths,
    paymentTerms: listing.paymentTerms,
    availableFrom: listing.availableFrom,
    description: listing.description,
    contactBroker: listing.contactBroker,
    galleryCount: Array.isArray(listing.gallery) ? listing.gallery.length : 0,
    // 读房源真实的 `merchant`，不能恒真：提交 endpoint 只校验状态机、从没调过
    // `checkListingCompleteness`，`merchant` 也没有锁定机制，所以「没有供给商户
    // 却 reviewStatus=pending」是可达状态。队列取数没做字段裁剪，`merchant` 随
    // 主对象免费返回，判真实值不产生任何额外查询。
    hasValidMerchantRelation: relationId(listing.merchant) != null,
  }
}
