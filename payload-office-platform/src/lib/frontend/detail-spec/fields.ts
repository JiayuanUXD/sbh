/**
 * OPT-083：详情页参数登记表的**元数据**——每一项的稳定键、前台标签、所属组与
 * 默认是否展示。
 *
 * ## 为什么元数据与取值函数分在两个文件
 *
 * 本文件被 `lib/frontend/site-settings-view.ts` 消费（生成第三层兜底），而那个
 * 文件是**客户端安全**的：`SiteHeader` / `SiteFooter` 是 `'use client'`，只要它们
 * 顺着依赖链拉到 `@/domain/public-catalog` 的索引或 `getPayload`，Turbopack 就会把
 * `sharp` 拉进浏览器包，`next build` 直接失败（57 个错误），而 typecheck 与单测
 * **全绿**——只有 `next build` 才会暴露（`site-settings-view.ts` 文件头记着这次教训）。
 *
 * 所以本文件**零 import**，是客户端安全的下界；需要 `factGroups` 类型与查值函数的
 * `resolve` 全部落在 `building-rows.ts` / `listing-rows.ts`，那两个文件只被服务端
 * 组件消费。两处不会漂移：resolver 表以本文件的 key 为索引，
 * `tests/opt083-detail-spec-registry.test.ts` 断言每个 key 都有对应 resolver。
 *
 * ## 改动须知
 *
 *   - `key` 是 `SiteSettings` 的字段名与 DB 列名基，**改名即运营已存的配置失效**。
 *   - `label` 只影响前台显示，改它不影响配置（配置认 key 不认 label）。
 *   - 新增一项要同时：加迁移列、更新 `tests/opt083-detail-spec-registry.test.ts`
 *     的零变化清单（如果它默认可见）、补 resolver。
 */

export type SpecFieldMeta<GroupId extends string> = Readonly<{
  key: string
  label: string
  group: GroupId
  defaultVisible: boolean
}>

/** 运营配置：key → 是否展示。缺键按 registry 的 `defaultVisible` 走，见 `isFieldVisible`。 */
export type SpecVisibilityMap = Readonly<Record<string, boolean>>

export type DetailSpecVisibility = Readonly<{
  building: SpecVisibilityMap
  listing: SpecVisibilityMap
}>

export type BuildingSpecGroupId = 'structure' | 'mep' | 'cost' | 'qualification'
export type ListingSpecGroupId = 'space' | 'terms' | 'delivery' | 'cost' | 'verification'

/** 组的**渲染顺序**即本对象的键序（`Object.keys` 保序），不另存一份 order 字段。 */
export const BUILDING_SPEC_GROUP_TITLES: Readonly<Record<BuildingSpecGroupId, string>> = {
  structure: '建筑',
  mep: '机电与设施',
  cost: '费用与管理',
  qualification: '资质与运营',
}

export const LISTING_SPEC_GROUP_TITLES: Readonly<Record<ListingSpecGroupId, string>> = {
  space: '面积与格局',
  terms: '租赁条件',
  delivery: '交付与资质',
  cost: '费用明细',
  verification: '信息时效',
}

/**
 * 楼盘参数 23 项。全部 `defaultVisible: true`——`mapBuildingFactGroups` 产出的事实
 * 已被改造前的面板用尽（其中「标准层高 / 净层高」「客梯 / 货梯」各合并成一行），
 * 候选池 = 现状清单，没有可增补的富余项。
 */
export const BUILDING_SPEC_FIELDS: readonly SpecFieldMeta<BuildingSpecGroupId>[] = [
  { key: 'buildingType', label: '物业类型', group: 'structure', defaultVisible: true },
  { key: 'grade', label: '楼盘等级', group: 'structure', defaultVisible: true },
  { key: 'completionYear', label: '竣工年份', group: 'structure', defaultVisible: true },
  { key: 'grossFloorArea', label: '总建筑面积', group: 'structure', defaultVisible: true },
  { key: 'totalFloors', label: '总楼层', group: 'structure', defaultVisible: true },
  { key: 'typicalFloorArea', label: '标准层面积', group: 'structure', defaultVisible: true },
  { key: 'floorHeight', label: '层高 / 净高', group: 'structure', defaultVisible: true },
  { key: 'efficiencyRate', label: '得房率', group: 'structure', defaultVisible: true },
  { key: 'elevators', label: '客梯 / 货梯', group: 'mep', defaultVisible: true },
  { key: 'airConditioning', label: '空调', group: 'mep', defaultVisible: true },
  { key: 'powerSupply', label: '供电', group: 'mep', defaultVisible: true },
  { key: 'network', label: '网络', group: 'mep', defaultVisible: true },
  { key: 'accessControl', label: '门禁', group: 'mep', defaultVisible: true },
  { key: 'elevatorZoning', label: '电梯分区', group: 'mep', defaultVisible: true },
  { key: 'serviceHours', label: '服务时间', group: 'mep', defaultVisible: true },
  { key: 'propertyFee', label: '物业费', group: 'cost', defaultVisible: true },
  { key: 'propertyCompany', label: '物业公司', group: 'cost', defaultVisible: true },
  { key: 'developer', label: '开发商', group: 'cost', defaultVisible: true },
  { key: 'parkingSpaces', label: '停车位', group: 'cost', defaultVisible: true },
  { key: 'parkingFee', label: '停车费', group: 'cost', defaultVisible: true },
  { key: 'certifications', label: '认证', group: 'qualification', defaultVisible: true },
  { key: 'registrationCapability', label: '可注册', group: 'qualification', defaultVisible: true },
  { key: 'minLeasableArea', label: '最小可租面积', group: 'qualification', defaultVisible: true },
]

/**
 * 房源概况 24 项：前 22 项即改造前的现状清单（`defaultVisible: true`），
 * 末尾「信息时效」组两项默认关闭。
 *
 * 「信息时效」是本工作项**新增**的组：`mapListingFactGroups` 一直在产出
 * `信息核验时间` / `价格核验时间`（`id: 'verification'`），但概况面板从没展示过。
 * 它们语义上不属于现有四组任何一组，硬塞进「交付与资质」是为了少开一个组而牺牲
 * 语义。默认全关 ⇒ 该组无可见行 ⇒ 整组不渲染，所以「上线零变化」仍然成立。
 */
export const LISTING_SPEC_FIELDS: readonly SpecFieldMeta<ListingSpecGroupId>[] = [
  { key: 'area', label: '建筑面积', group: 'space', defaultVisible: true },
  { key: 'usableArea', label: '套内参考面积', group: 'space', defaultVisible: true },
  { key: 'efficiencyRate', label: '得房率', group: 'space', defaultVisible: true },
  { key: 'netCeilingHeight', label: '净层高', group: 'space', defaultVisible: true },
  { key: 'seats', label: '工位估算', group: 'space', defaultVisible: true },
  { key: 'floor', label: '房源楼层', group: 'space', defaultVisible: true },
  { key: 'orientation', label: '朝向', group: 'space', defaultVisible: true },
  { key: 'divisible', label: '可分割', group: 'space', defaultVisible: true },
  { key: 'price', label: '合同单价', group: 'terms', defaultVisible: true },
  { key: 'minimumLease', label: '起租期', group: 'terms', defaultVisible: true },
  { key: 'deposit', label: '押金', group: 'terms', defaultVisible: true },
  { key: 'paymentTerms', label: '付款方式', group: 'terms', defaultVisible: true },
  { key: 'decoration', label: '装修状态', group: 'delivery', defaultVisible: true },
  { key: 'furniture', label: '家具', group: 'delivery', defaultVisible: true },
  { key: 'availableFrom', label: '交付时间', group: 'delivery', defaultVisible: true },
  { key: 'registration', label: '可注册', group: 'delivery', defaultVisible: true },
  { key: 'airConditioning', label: '空调', group: 'delivery', defaultVisible: true },
  { key: 'network', label: '网络', group: 'delivery', defaultVisible: true },
  { key: 'propertyFee', label: '物业费', group: 'cost', defaultVisible: true },
  { key: 'parkingFee', label: '停车费', group: 'cost', defaultVisible: true },
  { key: 'invoice', label: '发票', group: 'cost', defaultVisible: true },
  { key: 'otherFixedCosts', label: '其他固定费用', group: 'cost', defaultVisible: true },
  { key: 'verifiedAt', label: '信息核验时间', group: 'verification', defaultVisible: false },
  { key: 'priceVerifiedAt', label: '价格核验时间', group: 'verification', defaultVisible: false },
]

/**
 * 可见性判定。
 *
 * **缺键不等于关闭**：配置比代码旧（发版新增了候选项、而运营还没保存过一次）时，
 * 缺键必须落回 registry 的默认，否则一次发版就会让新字段集体消失，且运营在后台
 * 看到的是勾选状态（字段 defaultValue），与前台不一致——这是运营最容易误报、
 * 也最难查的那类不一致。同理，存量行的 NULL 列也走这条。
 */
export function isFieldVisible(
  field: Readonly<{ key: string; defaultVisible: boolean }>,
  visibility: SpecVisibilityMap | undefined,
): boolean {
  const configured = visibility?.[field.key]
  return typeof configured === 'boolean' ? configured : field.defaultVisible
}

/** registry 默认值展开成配置形状。兜底常量与后台字段 defaultValue 共用，不手抄。 */
export function specVisibilityDefaults(
  fields: readonly Readonly<{ key: string; defaultVisible: boolean }>[],
): SpecVisibilityMap {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultVisible]))
}

export const DETAIL_SPEC_VISIBILITY_DEFAULTS: DetailSpecVisibility = {
  building: specVisibilityDefaults(BUILDING_SPEC_FIELDS),
  listing: specVisibilityDefaults(LISTING_SPEC_FIELDS),
}
