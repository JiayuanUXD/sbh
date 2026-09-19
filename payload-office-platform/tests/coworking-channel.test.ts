import { describe, expect, it } from 'vitest'
import { parseListingSearchInput } from '@/domain/public-catalog'
import {
  buildCoworkingCanonicalParams,
  COWORKING_LISTING_TYPE,
  coworkingChannelPath,
  lockCoworkingInput,
} from '@/lib/frontend/coworking-channel'

/** OPT-103：共享办公独立频道的三个纯函数。 */
describe('coworking-channel', () => {
  it('路径：带城市前缀与 legacy 两种', () => {
    expect(coworkingChannelPath('shanghai')).toBe('/shanghai/coworking')
    expect(coworkingChannelPath()).toBe('/coworking')
  })

  it('lockCoworkingInput 强制类型为共享办公，覆盖 URL 里的任何 type', () => {
    const locked = lockCoworkingInput(parseListingSearchInput(new URLSearchParams('?type=full-floor&district=jingan')))
    expect(locked.listingType).toEqual([COWORKING_LISTING_TYPE])
    expect(locked.district).toEqual(['jingan'])
  })

  it('canonical 不输出 type，其余参数照旧', () => {
    const locked = lockCoworkingInput(parseListingSearchInput(new URLSearchParams('?district=jingan&areaMin=100&page=2')))
    expect(buildCoworkingCanonicalParams(locked).toString()).toBe('district=jingan&areaMin=100&page=2')
  })
})
