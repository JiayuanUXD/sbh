export type InquiryInput = {
  name?: string
  phone?: string
  message?: string
  listingSlug?: string
}

export type ValidationResult =
  | {
      ok: true
      data: Required<Pick<InquiryInput, 'name' | 'phone' | 'listingSlug'>> & { message: string }
      errors: []
    }
  | { ok: false; errors: string[] }

const CN_MOBILE = /^1[3-9]\d{9}$/

export function validateInquiry(input: InquiryInput): ValidationResult {
  const errors: string[] = []
  const name = (input.name || '').trim()
  const phone = (input.phone || '').trim()
  const message = (input.message || '').trim()
  const listingSlug = (input.listingSlug || '').trim()

  if (!name) errors.push('name_required')
  if (name.length > 50) errors.push('name_too_long')
  if (!CN_MOBILE.test(phone)) errors.push('phone_invalid')
  if (message.length > 500) errors.push('message_too_long')
  if (!listingSlug) errors.push('listing_required')

  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { name, phone, listingSlug, message }, errors: [] }
}
