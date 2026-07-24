import { describe, expect, it } from 'vitest'
import { parseListingFilters, buildListingWhere, type ListingFilters } from '@/lib/frontend/filters'

describe('parseListingFilters', () => {
  it('parses district, type, rent range, q from URLSearchParams', () => {
    const sp = new URLSearchParams('district=jingan&type=serviced-office&rentMin=2000&rentMax=5000&q=江景')
    const f = parseListingFilters(sp)
    expect(f).toEqual({
      district: 'jingan',
      listingType: 'serviced-office',
      rentMin: 2000,
      rentMax: 5000,
      q: '江景',
      page: 1,
    })
  })
  it('defaults page to 1 when absent', () => {
    expect(parseListingFilters(new URLSearchParams()).page).toBe(1)
  })
  it('clamps page to >=1', () => {
    expect(parseListingFilters(new URLSearchParams('page=0')).page).toBe(1)
    expect(parseListingFilters(new URLSearchParams('page=-3')).page).toBe(1)
  })
  it('ignores non-numeric rentMin', () => {
    expect(parseListingFilters(new URLSearchParams('rentMin=abc')).rentMin).toBeUndefined()
  })
})

describe('buildListingWhere', () => {
    it('builds where with status available always', () => {
      const f: ListingFilters = { page: 1 }
      const w = buildListingWhere(f)
      expect(w).toEqual({ status: { equals: 'available' } })
    })
    it('adds listingType equals', () => {
      const w = buildListingWhere({ listingType: 'coworking', page: 1 })
      expect((w as any).listingType.equals).toBe('coworking')
    })
    it('adds rent range', () => {
      const w = buildListingWhere({ rentMin: 100, rentMax: 500, page: 1 }) as any
      expect(w.rent.greater_than_equal).toBe(100)
      expect(w.rent.less_than_equal).toBe(500)
    })
    it('adds title contains for q', () => {
      const w = buildListingWhere({ q: '江景', page: 1 }) as any
      expect(w.title.contains).toBe('江景')
    })
    it('does NOT add district (district handled via building IDs in queries.ts)', () => {
      const w = buildListingWhere({ district: 'jingan', page: 1 }) as any
      expect(w.district).toBeUndefined()
    })
})