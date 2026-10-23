import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'

import { InvalidOperationError } from '@/domain/shared/errors'
import { findByIdSafe } from '@/domain/shared/transaction-safety'

import {
  hasValidCityProfileSeoLength,
  isCityServiceStatus,
  normalizeCityDisplayName,
} from './schema'

type Identifier = number | string

type LocationNode = {
  id: Identifier
  name?: string | null
  type?: unknown
  status?: unknown
  frontendVisible?: unknown
  city?: unknown
}

function relationshipId(value: unknown): Identifier | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    (typeof value.id === 'number' || typeof value.id === 'string')
  ) {
    return value.id
  }
  return null
}

function cityProfileError(code: string, message: string): InvalidOperationError {
  return new InvalidOperationError({ domain: 'geography', code, message: `${code}: ${message}` })
}

async function loadLocation(req: PayloadRequest, id: Identifier): Promise<LocationNode | null> {
  // findByIdSafe 而不是 try/catch 吞 NotFound：后者会连带回滚调用方的写入事务
  // （原因与实测见 domain/shared/transaction-safety.ts）
  return findByIdSafe<LocationNode>({
    req,
    collection: 'locations',
    id,
    depth: 0,
    operation: 'city-site-profile-protect:location',
  })
}

function assertTextIncludesCity(params: {
  value: unknown
  cityName: string
  field: 'description' | 'title'
  lengthErrorCode: string
  cityErrorCode: string
}): void {
  const { value, cityName, field, lengthErrorCode, cityErrorCode } = params
  if (!hasValidCityProfileSeoLength(value, field)) {
    throw cityProfileError(lengthErrorCode, '城市站点 SEO 文案长度不符合要求')
  }
  if (!value.includes(cityName)) {
    throw cityProfileError(cityErrorCode, '城市站点 SEO 文案必须包含城市名')
  }
}

export const protectCitySiteProfile: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const validationData = operation === 'update' && originalDoc ? { ...originalDoc, ...data } : data
  const cityId = relationshipId(validationData.city)
  if (cityId === null) {
    throw cityProfileError('city_profile_city_invalid', '城市站点必须关联启用的城市节点')
  }
  const city = await loadLocation(req, cityId)
  if (!city || city.type !== 'city' || city.status !== 'active') {
    throw cityProfileError('city_profile_city_invalid', '城市站点必须关联启用的城市节点')
  }

  if (!isCityServiceStatus(validationData.serviceStatus)) {
    throw cityProfileError('city_profile_service_status_invalid', '城市服务状态不合法')
  }

  const cityName = normalizeCityDisplayName(city.name)
  if (!cityName) {
    throw cityProfileError('city_profile_city_invalid', '城市节点缺少有效名称')
  }

  assertTextIncludesCity({
    value: validationData.seoTitle,
    cityName,
    field: 'title',
    lengthErrorCode: 'seo_title_length_invalid',
    cityErrorCode: 'seo_title_city_required',
  })
  assertTextIncludesCity({
    value: validationData.seoDescription,
    cityName,
    field: 'description',
    lengthErrorCode: 'seo_description_length_invalid',
    cityErrorCode: 'seo_description_city_required',
  })

  return data
}
