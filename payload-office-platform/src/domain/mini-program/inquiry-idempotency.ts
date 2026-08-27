import { createHash } from 'node:crypto'
import type { InquiryIdempotencyKey } from '@/domain/inquiry/idempotency'

export type MiniInquirySubmittedTargetType = 'listing' | 'building' | 'none'

const MINI_INQUIRY_IDEMPOTENCY_DOMAIN = 'mini-v1'
const MINI_ACCEPTANCE_INQUIRY_IDEMPOTENCY_DOMAIN = 'mini-v1-acceptance'

/**
 * Mini 提交防重键只在服务端生成；固定域确保它不会与含手机号的 Web 算法碰撞。
 */
export async function computeMiniInquiryIdempotencyKey(
  submissionRequestId: string,
  submittedTargetType: MiniInquirySubmittedTargetType,
  submittedTargetSlug: string,
): Promise<InquiryIdempotencyKey> {
  const raw = [
    MINI_INQUIRY_IDEMPOTENCY_DOMAIN,
    submissionRequestId,
    submittedTargetType,
    submittedTargetSlug,
  ].join('|')
  return createHash('sha256').update(raw, 'utf8').digest('hex') as InquiryIdempotencyKey
}

/** Mini 详情页始终按提交时 listing 目标计算，adapter 不开放客户端 targetType。 */
export function computeMiniListingInquiryIdempotencyKey(
  submissionRequestId: string,
  listingSlug: string,
): Promise<InquiryIdempotencyKey> {
  return computeMiniInquiryIdempotencyKey(submissionRequestId, 'listing', listingSlug)
}

/** Acceptance 写入防重键额外绑定 run，避免不同验收运行共享普通 Mini key。 */
export function computeMiniAcceptanceListingInquiryIdempotencyKey(
  runId: string,
  submissionRequestId: string,
  listingSlug: string,
): Promise<InquiryIdempotencyKey> {
  const raw = [
    MINI_ACCEPTANCE_INQUIRY_IDEMPOTENCY_DOMAIN,
    runId,
    submissionRequestId,
    'listing',
    listingSlug,
  ].join('|')
  return Promise.resolve(createHash('sha256').update(raw, 'utf8').digest('hex') as InquiryIdempotencyKey)
}
