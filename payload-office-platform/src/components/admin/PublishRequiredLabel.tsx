'use client'

import React from 'react'

/**
 * 发布必填标记（OPT-032 §3.3-E，即方案 B）。
 *
 * 房源有**两级门槛**（见 `domain/review/listing-completeness.ts` 头注释）：
 *   - 草稿保存：只要 title / building / listingType，随写随存；
 *   - 提交审核：另有一整套必填（租赁 15 项 / 出售 13 项）。
 *
 * 原实现给这两级各画一颗星（Payload 原生红 `*` = 草稿必填，琥珀 `*` = 提交必填），
 * 结果是同一个字段名后面挂两颗星。2026-08-19 用户要求**合并成一颗红星**：分级信号
 * 换成 tooltip 里的一句话，视觉上不再制造「这里为什么有两个星号」的疑问。分级本身
 * 没有消失——校验仍然是两级，只是不再在字段名旁边表达。
 *
 * 关键约束（未变）：标记必须是**纯视觉**的。绝不能把这些字段改成 `required: true`——
 * 那会打死「草稿随写随存」，运营连存个半成品都做不到。
 *
 * 标记来源是 `getSubmitRequiredFields(businessType)` 的派生映射（单一真源），
 * 由 `listing-publish-marks.ts` 统一装配，并有单测断言每个必填键都被覆盖。
 *
 * ⚠️ 本组件也会被**列表页的列头**渲染：Payload 的 `buildColumnState` 会把字段的
 * `admin.components.Label` 原样塞进 `SortColumn`。列头上的星号毫无意义（那里不填表），
 * 所以星号带 `.publish-required` 类，由 `custom.scss` 里
 * `.sort-column__label .publish-required { display: none }` 在列表页隐藏。
 * 这个类名去掉的话，星号会重新漏到列表页。
 */
export default function PublishRequiredLabel(props: { label?: string; required?: boolean }) {
  const { label = '' } = props
  return (
    <span className="field-label">
      {label}
      <span
        className="required publish-required"
        title="必填项：草稿可以先空着，提交审核前必须填完"
        aria-label="必填"
      >
        *
      </span>
    </span>
  )
}
