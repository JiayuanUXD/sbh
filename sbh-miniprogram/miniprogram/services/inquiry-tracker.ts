import type { UserAssets, UserInquiry } from './user-assets.js'

export type InquiryRecord = UserInquiry

export function getRecentInquiries(assets: UserAssets, limit = 10): readonly InquiryRecord[] {
  if (!Number.isSafeInteger(limit) || limit < 0) return []
  return assets.inquiries.slice(0, limit)
}

export function inquiryDetailRoute(inquiry: InquiryRecord): string | null {
  if (inquiry.targetType === 'general' || inquiry.targetSlug === null) return null
  const page = inquiry.targetType === 'listing' ? 'listing-detail' : 'building-detail'
  return `/pages/${page}/index?slug=${encodeURIComponent(inquiry.targetSlug)}`
}
