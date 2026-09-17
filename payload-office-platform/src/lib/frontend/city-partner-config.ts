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
  // OPT-101：第一步只留标题，不再带「此步成功保存后……」的引导句；
  // 表单卡下方的合规声明（「提交申请不代表合作确认……」）也已按产品裁定去掉。
  stageOneTitle: '请留下联系信息',
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
