/**
 * 发布必填标记的装配（OPT-032 §3.3-E / 方案 B）
 *
 * 单一真源是 `getSubmitRequiredFields(businessType)`。这里只做两件事：
 *   1. 把「完整度字段键」映射到「表单里挂标记的字段名」；
 *   2. 生成 `admin.components.Label`，让被标记的字段多出一个琥珀色 `*`。
 *
 * **禁止把这些字段改成 `required: true`**：房源是两级门槛（草稿随写随存 /
 * 提交审核才全量校验，见 `domain/review/listing-completeness.ts` 头注释），
 * 改成 required 会让运营连半成品都存不下。标记必须是纯视觉的。
 *
 * 配套单测 `tests/listing-publish-marks.test.ts` 断言：租赁与出售两种口径下，
 * `getSubmitRequiredFields` 返回的每一个键，要么在 FIELD_FOR_KEY 里、要么在
 * UNMARKABLE 里。以后往完整度里加条件而忘了标记，测试会红。
 */

import type { Field } from 'payload'

import { getSubmitRequiredFields } from '@/domain/review/listing-completeness'

/**
 * 完整度字段键 → 表单中承载标记的字段名。
 *
 * 多数是同名直连。两个例外：
 *   - `price` 标在 group 本身（金额/币种/周期/单位四件套缺一不可，标在任一子字段都不准）；
 *   - `merchant` 标在 Listings 上的关系字段。**这是近似**：实际门槛判的是
 *     `listing-merchant-relations` 里「当前有效」的关系记录，不是这个字段有没有值。
 *     标它是为了给运营一个落点，真实校验仍由 endpoint 兜。
 */
const FIELD_FOR_KEY: Record<string, string> = {
  title: 'title',
  building: 'building',
  listingType: 'listingType',
  businessType: 'businessType',
  decorationStatus: 'decorationStatus',
  price: 'price',
  area: 'area',
  floor: 'floor',
  description: 'description',
  contactBroker: 'contactBroker',
  merchant: 'merchant',
  minimumLeaseMonths: 'minimumLeaseMonths',
  paymentTerms: 'paymentTerms',
  availableFrom: 'availableFrom',
  propertyRightYears: 'propertyRightYears',
}

/**
 * 标不了的发布条件，必须显式登记（不允许静默漏标）。
 *
 * `gallery`：`admin.hidden: true` 的派生数组（由媒体工作台从 mediaItems 派生），
 * 界面上根本没有它的 label 可挂；而且条件是「≥3 张」——数量不是有无，
 * 一个星号本来也表达不了。这一项只能靠完整度清单（方案 C）兜。
 */
const UNMARKABLE = new Set<string>(['gallery'])

/** 租售两种口径下、所有会出现的发布必填键。 */
export function allSubmitRequiredKeys(): string[] {
  return [
    ...new Set([...getSubmitRequiredFields('lease'), ...getSubmitRequiredFields('sale')]),
  ]
}

/** 需要挂标记的表单字段名集合。 */
export function publishRequiredFieldNames(): Set<string> {
  const names = new Set<string>()
  for (const key of allSubmitRequiredKeys()) {
    if (UNMARKABLE.has(key)) continue
    const field = FIELD_FOR_KEY[key]
    if (field) names.add(field)
  }
  return names
}

/** 既没映射、也没登记为「标不了」的键——恒应为空，由单测把守。 */
export function unmappedSubmitRequiredKeys(): string[] {
  return allSubmitRequiredKeys().filter((key) => !UNMARKABLE.has(key) && !FIELD_FOR_KEY[key])
}

export { FIELD_FOR_KEY, UNMARKABLE }

/**
 * 给字段挂上发布必填标记。
 *
 * 用法：`mark({ name: 'floor', label: '楼层', type: 'text', admin: { width: COL_4 } })`
 * ——从字段自身读 label 与 required，装配出自定义 Label 组件，不改任何校验行为。
 */
export function markPublishRequired<T extends Field>(field: T): T {
  const name = (field as { name?: string }).name
  if (!name || !publishRequiredFieldNames().has(name)) return field

  const label = (field as { label?: unknown }).label
  const admin = ((field as { admin?: Record<string, unknown> }).admin ?? {}) as Record<
    string,
    unknown
  >
  const components = (admin.components ?? {}) as Record<string, unknown>

  return {
    ...field,
    admin: {
      ...admin,
      components: {
        ...components,
        Label: {
          path: '/components/admin/PublishRequiredLabel#default',
          clientProps: {
            label: typeof label === 'string' ? label : name,
            required: (field as { required?: boolean }).required === true,
          },
        },
      },
    },
  } as T
}
