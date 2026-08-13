import {
  CITY_PARTNER_IDENTITIES,
  CITY_PARTNER_IDENTITY_LABELS,
  CITY_PARTNER_RESOURCE_LABELS,
  CITY_PARTNER_RESOURCE_TYPES,
} from '@/domain/city-partner-application/schema'

export const CITY_PARTNER_COPY = {
  title: '城市合作伙伴申请',
  eyebrow: '共同服务本地企业',
  intro: '如果您熟悉本地商业办公市场，欢迎提交基础信息。我们会结合城市服务规划与双方资源情况进行沟通。',
  note: '提交申请不代表合作确认，也不构成收益、区域独家或开城时间承诺。',
  stageOneTitle: '先留下联系信息',
  stageOneHint: '此步成功保存后，您可以继续补充合作资源，也可以直接结束。',
  stageTwoTitle: '补充合作信息（可选）',
  stageTwoHint: '这些信息帮助我们更高效地了解合作方向。',
} as const

export const CITY_PARTNER_IDENTITY_OPTIONS = CITY_PARTNER_IDENTITIES.map((value) => ({
  value,
  label: CITY_PARTNER_IDENTITY_LABELS[value],
}))

export const CITY_PARTNER_RESOURCE_OPTIONS = CITY_PARTNER_RESOURCE_TYPES.map((value) => ({
  value,
  label: CITY_PARTNER_RESOURCE_LABELS[value],
}))
