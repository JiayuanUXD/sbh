import { describe, expect, it } from 'vitest'
import { mergeFieldAriaDescribedBy } from '@/components/frontend/ui/Field'

describe('mergeFieldAriaDescribedBy', () => {
  it('preserves a child description while adding field hint and error descriptions once', () => {
    expect(mergeFieldAriaDescribedBy('entrust-policy-note', 'entrust-phone-hint', 'entrust-phone-error'))
      .toBe('entrust-policy-note entrust-phone-hint entrust-phone-error')
  })
})
