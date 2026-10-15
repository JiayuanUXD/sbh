import { describe, expect, it } from 'vitest'

import { EFFECTIVE_SUPPLY_EXCLUSION_CODES } from '@/domain/review/effective-supply'
import {
  EFFECTIVE_SUPPLY_EXCLUSION_LABELS,
  effectiveSupplyExclusionLabel,
} from '@/domain/review/effective-supply-labels'

describe('有效供给排除原因文案（OPT-113）', () => {
  it('每个排除码都有中文文案', () => {
    for (const code of Object.values(EFFECTIVE_SUPPLY_EXCLUSION_CODES)) {
      expect(EFFECTIVE_SUPPLY_EXCLUSION_LABELS[code]).toMatch(/[一-龥]/)
    }
  })

  it('已知码翻成中文，未知码原样返回', () => {
    expect(effectiveSupplyExclusionLabel('NO_SUPPLY_MERCHANT')).toBe('未设置供给商户')
    expect(effectiveSupplyExclusionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})
