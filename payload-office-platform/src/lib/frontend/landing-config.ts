/** 落地页共享文案与静态服务数据。 */

export const BRAND_NAME = '商办租赁'
/**
 * 与站点 metadata 标题同源（`(frontend)/layout.tsx` 的
 * `商办租赁 · 上海中高端办公租赁平台`），不是待替换的占位文案。
 * 若要改品牌短标签，两处必须一起改，否则标题与落地页徽标会对不上。
 */
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

/**
 * 数字背书：三项都必须是能从生产库直接核对的事实，不放无法验证的服务承诺。
 *
 * 取数口径（2026-08-10 于生产库实测）：
 *   - 在租房源 2211 条：`SELECT count(*) FROM listings WHERE status = 'available'`（全部为 available）
 *   - 已收录写字楼 70 座：`SELECT count(*) FROM buildings`
 *   - 覆盖行政区 9 个：`SELECT count(DISTINCT district_id) FROM buildings WHERE district_id IS NOT NULL`
 *     （注意不要用 locations 里 206 条 business_area 条目冒充覆盖度，那是目录而非在营商圈）
 *
 * 刻意写成静态常量而非查库：两个落地页是全静态页（无 force-dynamic），
 * 为三个数字把整页动态化不值得。数据量显著变化时按上面的 SQL 重新核对再改这里。
 */
export const ENTRUST_STATS = [
  { value: '2200', unit: '+ 套', caption: '在租办公房源，价格与面积公开可查' },
  { value: '70', unit: ' 座', caption: '已收录写字楼，含实勘信息与配套' },
  { value: '9', unit: ' 个', caption: '覆盖上海核心行政区' },
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
  { label: '提交房源', icon: 'submit' },
  { label: '实勘采集', icon: 'survey' },
  { label: '推广曝光', icon: 'promote' },
  { label: '签约成交', icon: 'sign' },
] as const
