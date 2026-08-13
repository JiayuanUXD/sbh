export const CITY_PARTNER_IDENTITIES = [
  'owner-property',
  'broker-channel',
  'enterprise-service',
  'local-operations',
  'other',
] as const

export type CityPartnerIdentity = (typeof CITY_PARTNER_IDENTITIES)[number]

export const CITY_PARTNER_RESOURCE_TYPES = [
  'building-owner',
  'tenant-demand',
  'broker-network',
  'local-team',
  'government-association',
  'other',
] as const

export type CityPartnerResourceType = (typeof CITY_PARTNER_RESOURCE_TYPES)[number]

export const CITY_PARTNER_STATUSES = [
  'pending',
  'contacted',
  'evaluating',
  'qualified',
  'not-fit',
  'withdrawn',
] as const

export type CityPartnerStatus = (typeof CITY_PARTNER_STATUSES)[number]

const TRANSITIONS: Readonly<Record<CityPartnerStatus, readonly CityPartnerStatus[]>> = {
  pending: ['contacted', 'withdrawn'],
  contacted: ['evaluating', 'not-fit', 'withdrawn'],
  evaluating: ['qualified', 'not-fit', 'withdrawn'],
  qualified: [],
  'not-fit': [],
  withdrawn: [],
}

export function isCityPartnerStatus(value: unknown): value is CityPartnerStatus {
  return typeof value === 'string' && (CITY_PARTNER_STATUSES as readonly string[]).includes(value)
}

export function canTransitionCityPartner(
  from: CityPartnerStatus,
  to: CityPartnerStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export const CITY_PARTNER_IDENTITY_LABELS: Record<CityPartnerIdentity, string> = {
  'owner-property': '业主/物业运营方',
  'broker-channel': '商业地产经纪/渠道',
  'enterprise-service': '企业服务机构',
  'local-operations': '本地运营团队',
  other: '其他',
}

export const CITY_PARTNER_RESOURCE_LABELS: Record<CityPartnerResourceType, string> = {
  'building-owner': '楼宇/业主资源',
  'tenant-demand': '企业选址需求',
  'broker-network': '经纪渠道网络',
  'local-team': '本地运营团队',
  'government-association': '政府/商协会资源',
  other: '其他',
}

export const CITY_PARTNER_STATUS_LABELS: Record<CityPartnerStatus, string> = {
  pending: '待联系',
  contacted: '已联系',
  evaluating: '评估中',
  qualified: '合作意向确认',
  'not-fit': '暂不合适',
  withdrawn: '已撤回',
}
