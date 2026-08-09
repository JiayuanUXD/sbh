/** 落地页共享文案与静态服务数据。 */

export const BRAND_NAME = '商办租赁'
export const BRAND_BADGE = '上海中高端办公租赁平台'

export const ENTRUST_COPY = {
  title: `${BRAND_NAME}｜找办公室、写字楼租赁`,
  subtitle: '全城海量真房源，价格透明，服务专业。',
  formPlaceholder: '请输入手机号码，开启您的定制选址服务',
  formSubmit: '免费委托',
  consentNote: '提交即表示同意《隐私政策》，并授权我们与您联系。',
  processTitle: '选址服务流程',
  processSubtitle: '1 对 1 专属选址分析，全流程量身定制。',
  statsTitle: '核心服务能力',
  statsSubtitle: '全城海量真房源，价格透明，服务专业。',
  bottomCtaText: '现在，开始定制您的选址服务',
  bottomCtaLabel: '免费委托定制',
  successTitle: '已收到您的委托',
  successBody: '专属顾问将尽快与您联系，为您定制选址方案。',
} as const

/** 静态服务范围说明；如运营数据口径变更，应在此处统一更新。 */
export const ENTRUST_STATS = [
  { value: '全城', unit: '覆盖', caption: '上海核心商圈写字楼在租房源' },
  { value: '1', unit: '对 1', caption: '专属顾问选址分析，省心省力' },
  { value: '2', unit: '小时', caption: '工作时间内响应，快速给出方案' },
] as const

export const PUBLISH_COPY = {
  title: `房源委托 ${BRAND_NAME} 帮您出租`,
  subtitle: '海量客源，快速成交。',
  cardTitle: '免费投放房源',
  groupBuilding: '楼盘信息',
  groupCommission: '佣金',
  groupContact: '联系人信息',
  commissionNote: '您悬赏一定比例佣金会更快促进成交，成交后支付。',
  contactNote: '提交即授权将联系方式提供给服务机构人员，以便提供服务。',
  consentNote: '提交即表示同意《隐私政策》。',
  submit: '立即投放',
  cardFooter: BRAND_BADGE,
  successTitle: '已收到您的房源',
  successBody: '顾问将尽快与您联系，安排实勘与上架。',
} as const

export const ENTRUST_STEPS = [
  { label: '填写手机号码', icon: 'form' },
  { label: '专属顾问回访', icon: 'advisor' },
  { label: '定制选址方案', icon: 'plan' },
  { label: '实地看房签约', icon: 'sign' },
] as const

export const PUBLISH_STEPS = [
  { label: '提交房源', icon: 'form' },
  { label: '实勘采集', icon: 'survey' },
  { label: '推广曝光', icon: 'promote' },
  { label: '签约成交', icon: 'sign' },
] as const
