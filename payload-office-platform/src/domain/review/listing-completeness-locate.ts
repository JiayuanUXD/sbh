/**
 * 完整度缺失项 → 表单定位目标（D 项：房源信息不足的引导）
 *
 * `checkListingCompleteness` 返回的 `MissingItem.field` 是**完整度字段键**，
 * 不一定等于表单上那个字段的 label。要让运营点一下就跳到该填的地方，需要一张
 * 「键 → Tab + 字段 label」的映射；这张表就是它，和
 * `listing-self-visibility.ts` 的 `locateTab` / `locateFieldLabel` 同一套契约
 * （前端按 tab 按钮文字与字段 label 文本匹配 DOM）。
 *
 * ⚠️ 取值必须与 `Listings.ts` 里的 **tab label 和字段 label 逐字一致**——匹配是按
 * 文本做的，对不上就静默不动作。`tests/listing-completeness-locate.test.ts` 会把
 * 这张表和真实 collection 配置对一遍：字段改名而这里没跟上，测试会红。
 *
 * 无 payload / React 依赖，可独立单测。
 */

import { getSubmitRequiredFields } from '@/domain/review/listing-completeness'

/** 定位目标：Payload 编辑表单的 Tab 标题 + 该 Tab 内的字段 label。 */
export interface CompletenessLocateTarget {
  locateTab: '房源信息' | '展示内容'
  locateFieldLabel: string
}

/**
 * 完整度字段键 → 表单定位目标。
 *
 * 几个不同名的对应关系值得留意（都是「完整度键」与「表单 label」本就不同名）：
 *   - `listingType` 的表单 label 是「类型」而不是「房源类型」；
 *   - `price` 落在 group 本身（label「结构化价格」），四件套缺一不可，标到子字段都不准；
 *   - `gallery` 没有自己的 label（`admin.hidden` 的派生数组），落到媒体工作台上；
 *   - `merchant` 落在 Listings 的关系字段，真实校验是「当前有效的商户关系」，
 *     这里只给一个能改的落点。
 */
const LOCATE_FOR_KEY: Readonly<Record<string, CompletenessLocateTarget>> = {
  title: { locateTab: '房源信息', locateFieldLabel: '房源标题' },
  building: { locateTab: '房源信息', locateFieldLabel: '所属楼盘' },
  listingType: { locateTab: '房源信息', locateFieldLabel: '类型' },
  businessType: { locateTab: '房源信息', locateFieldLabel: '租售类型' },
  decorationStatus: { locateTab: '房源信息', locateFieldLabel: '装修状态' },
  price: { locateTab: '房源信息', locateFieldLabel: '结构化价格' },
  area: { locateTab: '房源信息', locateFieldLabel: '面积（㎡）' },
  floor: { locateTab: '房源信息', locateFieldLabel: '楼层' },
  minimumLeaseMonths: { locateTab: '房源信息', locateFieldLabel: '最短租期（月）' },
  paymentTerms: { locateTab: '房源信息', locateFieldLabel: '付款条件' },
  availableFrom: { locateTab: '房源信息', locateFieldLabel: '可入驻日期' },
  propertyRightYears: { locateTab: '房源信息', locateFieldLabel: '产权年限' },
  contactBroker: { locateTab: '房源信息', locateFieldLabel: '联系经纪人' },
  merchant: { locateTab: '房源信息', locateFieldLabel: '供给商户' },
  description: { locateTab: '展示内容', locateFieldLabel: '房源说明' },
  gallery: { locateTab: '展示内容', locateFieldLabel: '房源媒体工作台' },
}

/** 取某个完整度字段键的定位目标；无映射返回 null（前端退化为「只提示不跳转」）。 */
export function locateForCompletenessField(field: string): CompletenessLocateTarget | null {
  return LOCATE_FOR_KEY[field] ?? null
}

/** 租售两种口径下所有会出现的提交必填键（供单测穷举）。 */
export function allLocatableCompletenessKeys(): string[] {
  return [...new Set([...getSubmitRequiredFields('lease'), ...getSubmitRequiredFields('sale')])]
}

/** 有必填键但没登记定位目标的——恒应为空，由单测把守。 */
export function unmappedCompletenessKeys(): string[] {
  return allLocatableCompletenessKeys().filter((key) => LOCATE_FOR_KEY[key] === undefined)
}

export { LOCATE_FOR_KEY }
