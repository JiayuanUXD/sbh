import { describe, expect, it } from 'vitest'
import {
  getListingPublicBuildingWhere,
  getPublicBuildingWhere,
  isPublicBuilding,
} from '@/domain/supply/public-building'
import {
  BUILDING_JINGAN_CENTER,
  CITY_SHANGHAI,
  DISTRICT_JINGAN,
} from '@/test/frontend/payload-documents'

describe('public building visibility', () => {
  it('requires the building, city and district to all be public', () => {
    expect(isPublicBuilding(BUILDING_JINGAN_CENTER)).toBe(true)
    expect(isPublicBuilding({
      ...BUILDING_JINGAN_CENTER,
      city: { ...CITY_SHANGHAI, status: 'disabled' },
    })).toBe(false)
    expect(isPublicBuilding({
      ...BUILDING_JINGAN_CENTER,
      district: { ...DISTRICT_JINGAN, status: 'disabled' },
    })).toBe(false)
  })

  it('fails closed when city or district is not populated at read time', () => {
    expect(isPublicBuilding({ ...BUILDING_JINGAN_CENTER, city: CITY_SHANGHAI.id })).toBe(false)
    expect(isPublicBuilding({ ...BUILDING_JINGAN_CENTER, district: DISTRICT_JINGAN.id })).toBe(false)
  })

  it('provides the same positive predicate for building and listing queries', () => {
    expect(getPublicBuildingWhere()).toEqual({
      status: { equals: 'published' },
      operationalStatus: { equals: 'active' },
      deletedAt: { exists: false },
      'city.status': { equals: 'active' },
      'district.status': { equals: 'active' },
    })
    expect(getListingPublicBuildingWhere()).toEqual({
      'building.status': { equals: 'published' },
      'building.operationalStatus': { equals: 'active' },
      'building.deletedAt': { exists: false },
      'building.city.status': { equals: 'active' },
      'building.district.status': { equals: 'active' },
    })
  })
})
