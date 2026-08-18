import { NumberField } from '@nouance/payload-better-fields-plugin/Number'
import type { CollectionBeforeChangeHook, CollectionConfig, Field } from 'payload'

import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from '@/domain/review/review-status'
import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
  SUPPLY_VISIBILITY_HOLDS,
  SUPPLY_VISIBILITY_HOLD_LABELS,
} from '@/domain/review/publication-status'
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  COST_INCLUSION_STATUSES,
  COST_INCLUSION_STATUS_LABELS,
  DECORATION_STATUSES,
  PROPERTY_RIGHT_YEARS,
  PROPERTY_RIGHT_YEARS_LABELS,
  DECORATION_STATUS_LABELS,
  DETAIL_MEDIA_KINDS,
  DETAIL_MEDIA_KIND_LABELS,
  FURNITURE_STATUSES,
  FURNITURE_STATUS_LABELS,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  LISTING_MEDIA_CATEGORIES,
  LISTING_MEDIA_CATEGORY_LABELS,
  REGISTRATION_STATUSES,
  REGISTRATION_STATUS_LABELS,
} from '@/domain/review/listing-fields'
import { PRICING_PERIODS_UI, PRICING_UNITS_UI } from '@/domain/review/pricing-options'
import { getSaleChannelEnabled } from '@/lib/frontend/site-config'
import {
  MIN_SUBMIT_MEDIA,
  violatesPublishedMediaFloor,
} from '@/domain/review/listing-completeness'
import { protectListing } from '@/domain/review/listing-protect'
import { InvalidOperationError } from '@/domain/shared/errors'
import { createListingPublishEndpoint } from '@/endpoints/listing-publish-endpoint'
import { createListingReviewDecisionEndpoint } from '@/endpoints/listing-review-decision-endpoint'
import { markPublishRequired } from './listing-publish-marks'

type MediaResourceInput = number | string | { id?: number | string } | null | undefined

interface ListingMediaItemInput {
  kind?: string | null
  resource?: MediaResourceInput
  category?: string | null
  alt?: string | null
}

function toMediaId(resource: MediaResourceInput): number | string | null {
  if (resource === null || resource === undefined) return null
  if (typeof resource === 'object') {
    const id = (resource as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return typeof resource === 'number' || typeof resource === 'string' ? resource : null
}

/**
 * 房源媒体工作台的派生 hook（对齐楼盘 syncBuildingMedia 设计，另加存量兼容）：
 *
 *   1. gallery / coverImage 在表单中 hidden，统一由 mediaItems 派生：
 *      gallery = mediaItems 中 kind=image 的 resource 列表；
 *      coverImage 仅在无封面时自动取第一张图（回退看 originalDoc，防止每次保存重置运营手选封面）。
 *   2. 存量兼容：外部抓取的老房源只有 gallery 没有 mediaItems。
 *      首次经工作台保存（originalDoc.mediaItems 为空、本次非空）时，把 legacy gallery
 *      图片回填进 mediaItems 头部（kind=image / category=workspace / alt 自动生成），
 *      存量图不丢；此后删除、调序都按工作台链路走。
 *   3. 双方都无 mediaItems（纯存量、未动媒体）→ 不派生，legacy gallery 原样保留。
 *
 * 排在 protectListing 之前执行（派生先于校验，与楼盘 hook 顺序一致）。
 */
export const syncListingMedia: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const nextItems = Array.isArray(data?.mediaItems)
    ? (data.mediaItems as ListingMediaItemInput[])
    : null
  const prevItemCount = Array.isArray(originalDoc?.mediaItems)
    ? (originalDoc.mediaItems as ListingMediaItemInput[]).length
    : 0

  // 未走过工作台链路：nextItems 为空数组且文档原本也没有 mediaItems → 保持 legacy 现状
  const viaWorkbench = nextItems !== null && (nextItems.length > 0 || prevItemCount > 0)
  if (!viaWorkbench) return data

  let items = nextItems

  // 首次切换到工作台链路：回填 legacy gallery（去重）
  const legacyGallery = Array.isArray(originalDoc?.gallery)
    ? (originalDoc.gallery as { image?: MediaResourceInput }[])
    : []
  if (prevItemCount === 0 && items.length > 0 && legacyGallery.length > 0) {
    const existingIds = new Set(
      items.map((m) => toMediaId(m?.resource)).filter((id): id is number | string => id !== null),
    )
    const docTitle = typeof data?.title === 'string' && data.title ? data.title : '房源'
    const backfilled: ListingMediaItemInput[] = []
    for (const g of legacyGallery) {
      const id = toMediaId(g?.image)
      if (id === null || existingIds.has(id)) continue
      existingIds.add(id)
      backfilled.push({
        kind: 'image',
        resource: id,
        category: LISTING_MEDIA_CATEGORIES[0],
        alt: `${docTitle} 图集 ${backfilled.length + 1}`,
      })
    }
    if (backfilled.length > 0) items = [...backfilled, ...items]
  }

  // 1. 派生 gallery（审核提交校验 galleryCount>=3 与前台画廊都消费它，链路不变）
  const imageIds = items
    .filter((m) => m && m.kind === 'image' && m.resource)
    .map((m) => toMediaId(m.resource))
    .filter((id): id is number | string => id !== null)
  data.gallery = imageIds.map((image) => ({ image }))
  data.mediaItems = items

  // 1.1 已上架媒体地板：视频/平面图不计入 §6，删图跌破 3 张会让房源从前台静默消失
  //     （发布状态不变，后台仍显示「已发布」）。这里显式拦截，把静默下架变成可见错误。
  //     只约束工作台链路；纯存量房源（未走工作台）在上面已 return，不受影响。
  if (
    violatesPublishedMediaFloor({
      publicationStatus: data?.publicationStatus ?? originalDoc?.publicationStatus,
      galleryCount: imageIds.length,
    })
  ) {
    throw new InvalidOperationError({
      domain: 'review',
      code: 'PUBLISHED_MEDIA_FLOOR',
      message: `已上架房源至少需要 ${MIN_SUBMIT_MEDIA} 张图片（当前 ${imageIds.length} 张）；视频与平面图不计入。请先补图，或先将房源下架再清理媒体。`,
    })
  }

  // 2. 无封面时自动取第一张图
  const existingCover = data.coverImage ?? originalDoc?.coverImage
  if (!existingCover && imageIds.length > 0) {
    data.coverImage = imageIds[0]
  }

  return data
}

/**
 * 出售相关字段在后台的显隐（受 NEXT_PUBLIC_SALE_CHANNEL_ENABLED 控制）。
 *
 * 关键设计：**开关在服务端求值，决定"用哪个 condition 函数"**，而不是让 condition
 * 内部去读环境变量——Payload 的 admin.condition 在浏览器里执行，读不到服务端 env。
 * collection config 本身是服务端构建的，所以在这里分支是可靠的。
 *
 * 这一层只改 admin UI，不碰字段定义，因此不产生任何 schema 变化、不触发迁移。
 * 代价是它只挡入口不挡 API：直接调 Local/REST API 仍可写 businessType='sale'。
 * 对功能开关而言够用；若要连写入都禁掉，那是 access control 的范畴。
 */
const saleChannelEnabled = getSaleChannelEnabled()

/** 租售类型字段的显隐：开关关闭时只对「已经是出售」的记录显示。 */
const businessTypeCondition = saleChannelEnabled
  ? undefined
  : // 不做成一律隐藏：库里已有的出售房源若看不出自己的类型，运营会困惑
    // 「这条为什么不在租赁列表里」，那是比少一个字段更难查的问题。
    (data: Record<string, unknown> | undefined) => data?.businessType === 'sale'

/**
 * 「价格与交易参数」这个 tab 的文案本身也是功能信号：开关关闭时若仍叫这个名字、
 * 描述里还写着「产权信息只在出售房源显示」，等于在告诉运营「出售功能存在，只是你
 * 看不到」——字段藏干净了，标题却把它供出来。所以文案跟着开关一起回退到出售模式
 * 之前的原样。
 */
const priceTabLabel = saleChannelEnabled ? '价格与交易参数' : '租赁参数'
const priceTabDescription = saleChannelEnabled
  ? '集中维护结构化价格、面积、工位、楼层。租期/付款条件只在出租房源显示，产权信息只在出售房源显示。'
  : '集中维护结构化价格、面积、工位、楼层、租期和付款条件。'

/** 出售信息字段组的显隐：开关关闭时一律不显示。 */
const saleTermsCondition = saleChannelEnabled
  ? (data: Record<string, unknown> | undefined) => data?.businessType === 'sale'
  : () => false

/**
 * 固定列轴用的字段宽度（OPT-032 §3.3-A3）。
 *
 * 必须显式给 `admin.width`：Payload 的 `mergeFieldStyles` 在**没有** width 时下发的是
 * `flex: 1 1 auto`（grow=1），行内字段会拉伸填满整行——这就是「付款条件/可入驻日期」
 * 那种两字段行各占一半、跟上面四字段行对不齐的原因。给了 width 才走 Row 样式表里的
 * `flex: 0 1 calc(var(--field-width) - ...)`（grow=0），短行靠左留空、列轴对齐。
 */
const COL_3 = '33.333%'
const COL_4 = '25%'
const COL_FULL = '100%'

export const Listings: CollectionConfig = {
  slug: 'listings',
  labels: {
    singular: '房源',
    plural: '房源列表',
  },
  admin: {
    group: false,
    useAsTitle: 'title',
    defaultColumns: ['title', 'building', 'reviewStatus', 'publicationStatus', 'isFeatured'],
    preview: (doc) => (doc?.slug ? `/listings/${doc.slug}` : null),
    components: {
      edit: {
        // OPT-030 P0-2：表单修改态桥，把 useFormModified 同步给根部离开守卫。
        beforeDocumentControls: ['/components/admin/unsaved-changes/FormModifiedBridge'],
      },
    },
  },
  trash: true,
  access: {
    read: () => true,
  },
  // M4.6 显式动作端点：审核轴与发布轴各走独立端点，权限/前置门/乐观锁在 handler 内守护。
  endpoints: [createListingReviewDecisionEndpoint(), createListingPublishEndpoint()],
  hooks: {
    // syncListingMedia 必须排在 protectListing 之前：gallery/coverImage 由 mediaItems 派生，
    // 只有先派生再校验，保护逻辑与审核快照读到的才是最终数据（与楼盘 hook 顺序一致）。
    beforeChange: [syncListingMedia, protectListing],
  },
  fields: [
    {
      // OPT-030 §4 第一层：「前台可见性」常驻卡片，渲染在表单顶部，占满主内容区宽度。
      // 判定走 deriveListingSelfVisibility（与统一有效供给查询层谓词同口径），
      // 举报暂停由服务端组件复用 getPausedListingIds，不自拼查询。
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/ListingVisibilityCard',
        },
      },
    } as unknown as Field,
    {
      type: 'tabs',
      tabs: [
        {
          // OPT-032 §3.3-A1：原「基本信息 / 价格 / 审核与发布 / 数据来源」四个 tab 合并成一个，
          // 各自降级为 ui 分节标题（无 name，不进数据路径，零 schema 影响）。
          //
          // 不用 collapsible 做分节：它带折叠箭头、点标题会收起，且折叠态持久化到用户
          // preferences——一旦被收起，可见性卡片的点击定位就滚不到目标字段（Collapsible
          // 折叠时仍渲染 children，只是套 height: 0，label 找得到却不可见）。
          //
          // 「展示内容」坚决不并进来：它含媒体工作台（maxRows 40，mount 即发 /api/media
          // 并渲染最多 40 张缩略图，每张一个 COS 请求）与 Lexical 富文本，占全表单 87% 的
          // 首屏渲染量。Payload 客户端只渲染激活 tab，留它单独一个 tab 等于用一次点击挡掉这笔开销。
          label: '房源信息',
          description: '房源的全部录入项。图片与富文本在「展示内容」页签。',
          fields: [
            {
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '/components/admin/ListingFormSectionHeading#default',
                    clientProps: { title: '基本信息', description: '维护房源名称、URL 标识、类型和所属楼盘。' },
                  },
                },
              },
            } as unknown as Field,
            {
              type: 'row',
              fields: [
                markPublishRequired({
                  name: 'title',
                  label: '房源标题',
                  type: 'text',
                  required: true,
                  admin: {
                    width: COL_3,
                    // URL 标识收进标题框右侧的图标（见 ListingSlugBadge 注释）
                    components: { afterInput: ['/components/admin/ListingSlugBadge#default'] },
                  },
                }),
                markPublishRequired({
                  name: 'listingType',
                  label: '类型',
                  type: 'select',
                  required: true,
                  defaultValue: 'traditional-office',
                  admin: { width: COL_3 },
                  options: [
                    { label: '传统办公室', value: 'traditional-office' },
                    { label: '共享办公', value: 'coworking' },
                    { label: '整层办公', value: 'full-floor' },
                    // 该枚举值当初保留是为「只删导航入口、不动数据」，不可改标签作它用：
                    // 改标签会把存量「服务式办公室」房源静默重标注为另一种业态。
                    { label: '服务式办公室', value: 'serviced-office' },
                  ],
                }),
                markPublishRequired({
                  name: 'building',
                  label: '所属楼盘',
                  type: 'relationship',
                  relationTo: 'buildings',
                  required: true,
                  admin: { width: COL_3 },
                }),
              ],
            },
            {
              type: 'row',
              fields: [
                markPublishRequired({
                  name: 'businessType',
                  label: '租售类型',
                  type: 'select',
                  defaultValue: 'lease',
                  admin: { condition: businessTypeCondition, width: COL_3 },
                  options: BUSINESS_TYPES.map((value) => ({
                    label: BUSINESS_TYPE_LABELS[value],
                    value,
                  })),
                }),
                markPublishRequired({
                  name: 'decorationStatus',
                  label: '装修状态',
                  type: 'select',
                  admin: { width: COL_3 },
                  options: DECORATION_STATUSES.map((value) => ({
                    label: DECORATION_STATUS_LABELS[value],
                    value,
                  })),
                }),
                {
                  name: 'registrationStatus',
                  label: '工商注册状态',
                  type: 'select',
                  admin: { width: COL_3 },
                  options: REGISTRATION_STATUSES.map((value) => ({
                    label: REGISTRATION_STATUS_LABELS[value],
                    value,
                  })),
                },
              ],
            },
            {
              name: 'slug',
              label: 'URL 标识',
              type: 'text',
              required: true,
              unique: true,
              admin: {
                // 从表单里撤下，但保留在 API 响应与库里（见 ListingSlugBadge 注释的四种写法对比）。
                //
                // 为什么是 disabled 而不是另外三种：
                //   - admin.hidden：字段仍进表单状态并参与校验，新建时 slug 为空会被一个
                //     **看不见的必填错误**拦住保存，屏幕上没有字段可修。
                //   - 顶层 hidden：afterRead 会把 slug 从 API 响应删掉，前台详情页直接崩。
                //   - admin.condition: () => false：表单行为没问题，但 configToJSONSchema 的
                //     fieldIsRequired 对**任何带 condition 的字段一律判为非必填**（无视
                //     required: true），生成类型会退化成 slug?: string | null，
                //     连累 mappers / supply-adapter 等前台消费方——为一个后台布局改动
                //     永久弱化前台类型契约，不划算。
                //   - admin.disabled：不渲染、不进表单状态、不校验、不影响 API 与生成类型。
                disabled: true,
                description:
                  '留空时根据房源标题自动生成拼音 slug；如手动填写则保留自定义值。用于前台 URL（/listings/xxx）。',
              },
            },
            {
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '/components/admin/ListingFormSectionHeading#default',
                    clientProps: { title: priceTabLabel, description: priceTabDescription },
                  },
                },
              },
            } as unknown as Field,
            markPublishRequired({
              name: 'price',
              label: '结构化价格',
              type: 'group',
              admin: {
                description: '价格必须保存金额、币种、周期和单位,禁止仅存展示文本。',
              },
              fields: [
                {
                  // 四件套排一行：amount + currency + period + unit 本来就是不可拆的整体。
                  type: 'row',
                  fields: [
                    ...NumberField(
                      { name: 'amount', label: '金额', admin: { width: COL_4 } },
                      { thousandSeparator: ',', decimalScale: 2 },
                    ),
                    {
                      name: 'currency',
                      label: '币种',
                      type: 'select',
                      defaultValue: 'CNY',
                      admin: { width: COL_4 },
                      options: [{ label: '人民币', value: 'CNY' }],
                    },
                    {
                      name: 'period',
                      label: '计价周期',
                      type: 'select',
                      defaultValue: 'month',
                      admin: { width: COL_4 },
                      options: PRICING_PERIODS_UI.map(({ label, value }) => ({ label, value })),
                    },
                    {
                      name: 'unit',
                      label: '计价单位',
                      type: 'select',
                      defaultValue: 'sqm',
                      admin: { width: COL_4 },
                      options: PRICING_UNITS_UI.map(({ label, value }) => ({ label, value })),
                    },
                  ],
                },
              ],
            }),
            {
              // 过渡期旧字段：仅存量数据已有值时显示（新数据一律走结构化价格）
              type: 'row',
              fields: [
                ...NumberField(
                  {
                    name: 'rent',
                    label: '租金（旧字段,过渡期保留）',
                    admin: {
                      condition: (data) => data?.rent != null,
                      description: '价格已迁移至上方结构化价格,此字段仅供过渡期兼容。',
                      width: COL_4,
                    },
                  },
                  { thousandSeparator: ',', decimalScale: 2 },
                ),
                {
                  name: 'rentUnit',
                  label: '租金单位（旧字段）',
                  type: 'select',
                  defaultValue: 'rmb-sqm-day',
                  admin: { condition: (data) => data?.rent != null, width: COL_4 },
                  options: [
                    { label: '元/㎡/天', value: 'rmb-sqm-day' },
                    { label: '元/月', value: 'rmb-month' },
                    { label: '元/工位/月', value: 'rmb-seat-month' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                ...NumberField(
                  { name: 'area', label: '面积（㎡）', admin: { width: COL_4 } },
                  { thousandSeparator: ',', decimalScale: 1 },
                ).map(markPublishRequired),
                ...NumberField(
                  { name: 'seats', label: '建议工位数', admin: { width: COL_4 } },
                  { thousandSeparator: ',', decimalScale: 0 },
                ),
                markPublishRequired({
                  name: 'floor',
                  label: '楼层',
                  type: 'text',
                  admin: { width: COL_4 },
                }),
                ...NumberField(
                  {
                    name: 'minimumLeaseMonths',
                    label: '最短租期（月）',
                    admin: {
                      // 出售没有租期概念。隐藏而非删除：存量租赁房源的值要留着。
                      condition: (data) => data?.businessType !== 'sale',
                      width: COL_4,
                    },
                  },
                  { thousandSeparator: ',', decimalScale: 0 },
                ).map(markPublishRequired),
              ],
            },
            {
              // 与上一行的「最短租期」同为租赁专属：切到出售时这两个字段一起消失，整行干净收起。
              type: 'row',
              fields: [
                markPublishRequired({
                  name: 'paymentTerms',
                  label: '付款条件',
                  type: 'text',
                  admin: {
                    // 买卖的付款方式在合同阶段谈，不在房源页承诺。
                    condition: (data) => data?.businessType !== 'sale',
                    width: COL_4,
                  },
                }),
                markPublishRequired({
                  name: 'availableFrom',
                  label: '可入驻日期',
                  type: 'date',
                  admin: {
                    // 买卖是交割日不是入驻日，语义不同，不复用该字段。
                    condition: (data) => data?.businessType !== 'sale',
                    width: COL_4,
                  },
                }),
              ],
            },
            {
              name: 'spaceDetails',
              label: '空间明细',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'efficiencyRate',
                      label: '得房率（%）',
                      type: 'number',
                      min: 0,
                      max: 100,
                      admin: { width: COL_4 },
                    },
                    { name: 'orientation', label: '朝向', type: 'text', maxLength: 30, admin: { width: COL_4 } },
                    { name: 'netCeilingHeight', label: '净层高（m）', type: 'number', min: 0, admin: { width: COL_4 } },
                    {
                      name: 'furnitureStatus',
                      label: '家具状态',
                      type: 'select',
                      admin: { width: COL_4 },
                      options: FURNITURE_STATUSES.map((value) => ({
                        label: FURNITURE_STATUS_LABELS[value],
                        value,
                      })),
                    },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'seatMin', label: '最少工位数', type: 'number', min: 0, admin: { width: COL_4 } },
                    { name: 'seatMax', label: '最多工位数', type: 'number', min: 0, admin: { width: COL_4 } },
                    { name: 'isDivisible', label: '可分割', type: 'checkbox', defaultValue: false, admin: { width: COL_4 } },
                  ],
                },
              ],
            },
            {
              name: 'saleTerms',
              label: '出售信息',
              type: 'group',
              admin: {
                condition: saleTermsCondition,
                description:
                  '仅出售房源填写。产权年限为纯展示信息，平台不做年限折损计算——剩余年限依赖产权起始日准确性，算错会影响买方的投资回报测算。',
              },
              fields: [
                {
                  type: 'row',
                  fields: [
                    markPublishRequired({
                      name: 'propertyRightYears',
                      label: '产权年限',
                      type: 'select',
                      options: PROPERTY_RIGHT_YEARS.map((value) => ({
                        label: PROPERTY_RIGHT_YEARS_LABELS[value],
                        value,
                      })),
                      admin: {
                        description: '出售房源提交审核必填。枚举取值，避免「四十年」这类脏值。',
                        width: COL_4,
                      },
                    }),
                    {
                      name: 'saleTaxBearer',
                      label: '税费承担方',
                      type: 'select',
                      admin: { width: COL_4 },
                      options: [
                        { label: '买方承担', value: 'buyer' },
                        { label: '卖方承担', value: 'seller' },
                        { label: '双方各半', value: 'split' },
                        { label: '面议', value: 'negotiable' },
                      ],
                    },
                    {
                      name: 'saleFiveYearsUnique',
                      label: '是否满五唯一',
                      type: 'checkbox',
                      admin: { description: '影响税费，买方常问。', width: COL_4 },
                    },
                    { name: 'saleParkingSpaces', label: '车位配置（个）', type: 'number', min: 0, admin: { width: COL_4 } },
                  ],
                },
              ],
            },
            {
              name: 'costTerms',
              label: '费用条款',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'depositMonths', label: '押金月数', type: 'number', min: 0, admin: { width: COL_4 } },
                    {
                      name: 'propertyFeeInclusion',
                      label: '物业费包含情况',
                      type: 'select',
                      admin: { width: COL_4 },
                      options: COST_INCLUSION_STATUSES.map((value) => ({
                        label: COST_INCLUSION_STATUS_LABELS[value],
                        value,
                      })),
                    },
                    { name: 'propertyFeeAmount', label: '物业费金额', type: 'number', min: 0, admin: { width: COL_4 } },
                    {
                      name: 'invoiceStatus',
                      label: '发票情况',
                      type: 'select',
                      admin: { width: COL_4 },
                      options: INVOICE_STATUSES.map((value) => ({
                        label: INVOICE_STATUS_LABELS[value],
                        value,
                      })),
                    },
                  ],
                },
                { name: 'otherFixedCosts', label: '其他固定费用', type: 'textarea', maxLength: 500, admin: { width: COL_FULL } },
              ],
            },
            { name: 'isFeatured', label: '首页推荐', type: 'checkbox', defaultValue: false, admin: { width: COL_4 } },
            {
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '/components/admin/ListingFormSectionHeading#default',
                    clientProps: { title: '审核与发布', description: '三轴状态由审核/发布流程驱动,此处只读;版本号用于并发乐观锁。' },
                  },
                },
              },
            } as unknown as Field,
            {
              // 免审直发入口。放在这里而不是审核台：直发的起点是「未提交 / 已驳回」，
              // 这些房源根本不在 pending 队列里。可见性（权限 + 状态）全由服务端组件
              // 判定，客户端只负责触发；完整度由 endpoint 强制。
              type: 'ui',
              admin: {
                components: {
                  Field: '/components/admin/ListingFastTrackAction',
                },
              },
            } as unknown as Field,
            {
              // OPT-032 §3.3-A4：可编辑字段在前、只读状态在后。运营进这一节是来填
              // 商户 / 经纪人的，四个只读状态是「看一眼」的结论，放末尾更贴合动线。
              // 字段顺序即显示顺序，不涉及 schema。
              type: 'row',
              fields: [
                markPublishRequired({
                  name: 'merchant',
                  label: '供给商户',
                  type: 'relationship',
                  relationTo: 'merchants',
                  admin: {
                    description: '房源供给关系的当前商户;有效期与快照规则见供给关系。',
                    width: COL_4,
                  },
                }),
                markPublishRequired({
                  name: 'contactBroker',
                  label: '联系经纪人',
                  type: 'relationship',
                  relationTo: 'brokers',
                  admin: { width: COL_4 },
                }),
              ],
            },
            {
              name: 'verificationInfo',
              label: '核验信息',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'verifiedAt', label: '信息核验时间', type: 'date', admin: { width: COL_4 } },
                    { name: 'priceVerifiedAt', label: '价格核验时间', type: 'date', admin: { width: COL_4 } },
                  ],
                },
              ],
            },
            {
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '/components/admin/ListingFormSectionHeading#default',
                    clientProps: { title: '状态（只读）', description: undefined },
                  },
                },
              },
            } as unknown as Field,
            {
              type: 'row',
              fields: [
                {
                  name: 'reviewStatus',
                  label: '审核状态',
                  type: 'select',
                  defaultValue: 'not_submitted',
                  admin: {
                    readOnly: true,
                    description: '由提交/审核流程驱动。',
                    width: COL_4,
                    components: { Field: '/components/admin/ListingReadonlyValue#default' },
                  },
                  options: REVIEW_STATUSES.map((value) => ({
                    label: REVIEW_STATUS_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'publicationStatus',
                  label: '发布状态',
                  type: 'select',
                  defaultValue: 'draft',
                  admin: {
                    readOnly: true,
                    description: '由显式发布/下架动作驱动,审核通过不自动上架。',
                    width: COL_4,
                    components: { Field: '/components/admin/ListingReadonlyValue#default' },
                  },
                  options: PUBLICATION_STATUSES.map((value) => ({
                    label: PUBLICATION_STATUS_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'supplyVisibilityHold',
                  label: '供给可见性冻结',
                  type: 'select',
                  defaultValue: 'normal',
                  admin: {
                    readOnly: true,
                    description: '商户停用等场景批量置为待复核,不改动审核/发布状态。',
                    width: COL_4,
                    components: { Field: '/components/admin/ListingReadonlyValue#default' },
                  },
                  options: SUPPLY_VISIBILITY_HOLDS.map((value) => ({
                    label: SUPPLY_VISIBILITY_HOLD_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'version',
                  label: '版本号',
                  type: 'number',
                  defaultValue: 1,
                  admin: {
                    readOnly: true,
                    description: '乐观锁版本号,系统维护。',
                    width: COL_4,
                    components: { Field: '/components/admin/ListingReadonlyValue#default' },
                  },
                },
              ],
            },
            {
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '/components/admin/ListingFormSectionHeading#default',
                    clientProps: { title: '数据来源', description: '标记外部抓取来源与同步信息，便于追溯、去重与增量更新。' },
                  },
                },
              },
            } as unknown as Field,
            {
              name: 'dataSource',
              label: '数据来源',
              type: 'group',
              admin: {
                hideGutter: true,
                // 仅外部抓取来源已有数据时显示；手工新建的房源不需要维护此组字段
                condition: (data) => {
                  const ds = data?.dataSource as
                    | {
                        source?: string | null
                        externalId?: string | null
                        sourceUrl?: string | null
                        syncedAt?: string | null
                      }
                    | null
                    | undefined
                  return Boolean(ds && (ds.source || ds.externalId || ds.sourceUrl || ds.syncedAt))
                },
              },
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'source',
                      label: '来源平台',
                      type: 'select',
                      options: [{ label: '汇租选址', value: 'huizuxuanzhi' }],
                      admin: { description: '外部抓取来源标识', width: COL_4 },
                    },
                    { name: 'externalId', label: '外部 ID', type: 'text', admin: { description: '源平台原始房源编号', width: COL_4 } },
                    {
                      name: 'syncedAt',
                      label: '同步时间',
                      type: 'date',
                      admin: { readOnly: true, description: '最后一次从源平台同步的时间', width: COL_4 },
                    },
                    { name: 'sourceUrl', label: '源地址', type: 'text', admin: { description: '详情页原始 URL', width: COL_4 } },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: '展示内容',
          description: '维护前台卡片和详情页使用的图片、亮点与介绍。',
          fields: [
            {
              // hidden：由房源媒体工作台（ListingMediaManager）操作，
              // 保存时 syncListingMedia 从 mediaItems 派生（对齐楼盘媒体链路设计）。
              name: 'coverImage',
              label: '封面图',
              type: 'upload',
              relationTo: 'media',
              admin: { hidden: true },
            },
            {
              // hidden：同上，gallery = mediaItems 中 kind=image 的派生列表，
              // 审核提交校验（galleryCount>=3）与前台画廊继续消费 gallery，链路不变。
              name: 'gallery',
              label: '图片相册',
              type: 'array',
              admin: { hidden: true },
              fields: [
                { name: 'image', label: '图片', type: 'upload', relationTo: 'media', required: true },
              ],
            },
            {
              name: 'mediaItems',
              label: '房源媒体工作台',
              type: 'array',
              maxRows: 40,
              admin: {
                description: '提交审核要求至少 3 张有效图片（kind=图片）。封面与相册由这里自动派生。',
                components: {
                  Field: '/components/admin/ListingMediaManager',
                },
              },
              fields: [
                { name: 'resource', label: '资源', type: 'upload', relationTo: 'media', required: true },
                {
                  name: 'kind',
                  label: '类型',
                  type: 'select',
                  required: true,
                  options: DETAIL_MEDIA_KINDS.map((value) => ({
                    label: DETAIL_MEDIA_KIND_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'category',
                  label: '分类',
                  type: 'select',
                  required: true,
                  options: LISTING_MEDIA_CATEGORIES.map((value) => ({
                    label: LISTING_MEDIA_CATEGORY_LABELS[value],
                    value,
                  })),
                },
                { name: 'alt', label: '替代文本', type: 'text', required: true, maxLength: 160 },
                { name: 'capturedAt', label: '拍摄时间', type: 'date' },
                { name: 'isSchematic', label: '示意图', type: 'checkbox', defaultValue: false },
              ],
            },
            {
              name: 'highlights',
              label: '亮点',
              type: 'array',
              fields: [{ name: 'text', label: '亮点文案', type: 'text' }],
            },
            markPublishRequired({
              name: 'description',
              label: '房源说明',
              type: 'richText',
            }),
          ],
        },
      ],
    },
  ],
}
