'use client'

import React from 'react'

/**
 * 发布必填标记（OPT-032 §3.3-E，即方案 B）。
 *
 * 房源有**两级门槛**（见 `domain/review/listing-completeness.ts` 头注释）：
 *   - 草稿保存：只要 title / building / listingType，随写随存；
 *   - 提交审核：另有一整套必填（租赁 15 项 / 出售 13 项）。
 *
 * Payload 原生的红色 `*` 表达的是第一级（字段 `required: true`）。第二级此前在
 * 表单上完全不可见——运营填完点提交才被拦。这里补一个**琥珀色** `*` 表示第二级。
 *
 * 关键约束：标记必须是**纯视觉**的。绝不能把这些字段改成 `required: true`——
 * 那会打死「草稿随写随存」，运营连存个半成品都做不到。
 *
 * 标记来源是 `getSubmitRequiredFields(businessType)` 的派生映射（单一真源），
 * 由 `listing-publish-marks.ts` 统一装配，并有单测断言每个必填键都被覆盖。
 */
export default function PublishRequiredLabel(props: { label?: string; required?: boolean }) {
  const { label = '', required = false } = props
  return (
    <span className="field-label">
      {label}
      {required ? <span className="required">*</span> : null}
      <span
        className="publish-required"
        title="提交审核必填（草稿可以先空着）"
        aria-label="提交审核必填"
      >
        *
      </span>
    </span>
  )
}
