import { ValidationError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

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

/**
 * 精选区域校验失败抛**字段级** ValidationError，并点名是哪个节点。
 *
 * 此前抛的是 InvalidOperationError：后台只有一条几秒消失的 toast（不说是哪个商圈）、
 * 字段无红字、失败后「保存」按钮还变灰——运营以为存上了，退出再进值就「消失」。
 * 线上两个同名「虹桥」里闵行那个前台不可见，选错一个整条保存作废，正是这条路。
 * 字段级错误由 LocationCascadeField 里的 FieldError 渲染，一直挂着直到改对。
 * 文案要短：Payload 的字段错误是单行 tooltip，长了会被截成省略号；「怎么修」放在
 * 字段的 description 里常驻显示，不塞进错误里。没有调用方按错误码识别这几条，不带码。
 */
function featuredRegionError(req: PayloadRequest, message: string): ValidationError {
  // 第二个参数 t 与 label 决定 toast 文案：不传就是英文 "The following field is invalid: featuredRegions"
  return new ValidationError(
    {
      collection: 'city-site-profiles',
      errors: [{ path: 'featuredRegions', label: '精选区域', message }],
      req,
    },
    req.t,
  )
}

function regionLabel(region: LocationNode | null, id: Identifier): string {
  const name = typeof region?.name === 'string' && region.name.trim() ? region.name.trim() : `#${id}`
  return `「${name}」`
}

async function assertFeaturedRegions(params: {
  req: PayloadRequest
  cityId: Identifier
  value: unknown
}): Promise<void> {
  const { req, cityId, value } = params
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) {
    throw featuredRegionError(req, '精选区域必须是区域关系列表')
  }

  for (const relation of value) {
    const regionId = relationshipId(relation)
    const region = regionId === null ? null : await loadLocation(req, regionId)
    const label = regionLabel(region, regionId ?? '?')
    if (!region || (region.type !== 'district' && region.type !== 'business_area')) {
      throw featuredRegionError(req, `${label}不是行政区或商圈，不能作为精选区域`)
    }
    if (region.status !== 'active') {
      throw featuredRegionError(req, `${label}已停用，不能作为精选区域`)
    }
    if (region.frontendVisible !== true) {
      throw featuredRegionError(req, `${label}前台不可见，不能作为精选区域`)
    }
    const regionCityId = relationshipId(region.city)
    if (regionCityId === null || String(regionCityId) !== String(cityId)) {
      throw featuredRegionError(req, `${label}不属于当前城市`)
    }
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

  await assertFeaturedRegions({ req, cityId, value: validationData.featuredRegions })

  return data
}
