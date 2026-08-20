'use client'

import React, { useEffect, useMemo, useRef } from 'react'
import { Message, Tag, Typography } from '@arco-design/web-react'
import { useDocumentInfo, useField, useFormProcessing, useFormSubmitted } from '@payloadcms/ui'

import {
  checkListingCompleteness,
  type ListingCompletenessSnapshot,
  type MissingItem,
} from '@/domain/review/listing-completeness'
import { locateForCompletenessField } from '@/domain/review/listing-completeness-locate'
import { locateFormField } from './locate-form-field'

const { Text } = Typography

/**
 * 房源编辑页「信息完整度」卡片 - 客户端（D 项：房源信息不足的引导）
 *
 * 做三件事：
 *   1. 常驻展示提交审核还缺哪些项（含缺失原因），实时跟随表单值；
 *   2. 点击缺失项 → 切 Tab、展开折叠分节、滚到该字段并**闪红描边**；
 *   3. 保存成功但仍有缺失时 Toast 一次，避免「保存成功」被读成「已经填完」。
 *
 * 口径来自 `checkListingCompleteness(snapshot, 'submit')`——与
 * `decideAdminAutoPublish` 调的是同一个纯函数。管理员保存即发布**不再被完整度
 * 拦截**（2026-08-19 决定），所以这张卡片是管理员唯一能看到「发出去了但还缺东西」
 * 的地方；它必须说「已保存但还缺 X」，而不是拦着不让保存。
 *
 * 商户判定看「有没有选商户」——OPT-034 起 `listings.merchant` 即唯一真相，
 * 不再是近似，与 `admin-auto-publish-hook.ts` 同口径，真实校验仍由 endpoint 兜。
 */

/** array 字段父路径在有行时存行数（number），无行时可能是 undefined 或数组。 */
function rowCount(formValue: unknown, docValue: unknown): number {
  if (typeof formValue === 'number' && Number.isFinite(formValue)) return formValue
  if (Array.isArray(formValue)) return formValue.length
  if (Array.isArray(docValue)) return docValue.length
  return 0
}

/** 表单值优先（未保存的编辑即时反映）；表单尚未同步时回落文档基线。 */
function pick(formValue: unknown, docValue: unknown): unknown {
  return formValue === undefined || formValue === null || formValue === '' ? docValue : formValue
}

export default function ListingCompletenessCardClient() {
  const { data } = useDocumentInfo()
  const doc = (data ?? {}) as Record<string, unknown>

  const { value: title } = useField<unknown>({ path: 'title' })
  const { value: building } = useField<unknown>({ path: 'building' })
  const { value: listingType } = useField<unknown>({ path: 'listingType' })
  const { value: businessType } = useField<unknown>({ path: 'businessType' })
  const { value: decorationStatus } = useField<unknown>({ path: 'decorationStatus' })
  const { value: priceAmount } = useField<unknown>({ path: 'price.amount' })
  const { value: priceCurrency } = useField<unknown>({ path: 'price.currency' })
  const { value: pricePeriod } = useField<unknown>({ path: 'price.period' })
  const { value: priceUnit } = useField<unknown>({ path: 'price.unit' })
  const { value: area } = useField<unknown>({ path: 'area' })
  const { value: floor } = useField<unknown>({ path: 'floor' })
  const { value: minimumLeaseMonths } = useField<unknown>({ path: 'minimumLeaseMonths' })
  const { value: paymentTerms } = useField<unknown>({ path: 'paymentTerms' })
  const { value: availableFrom } = useField<unknown>({ path: 'availableFrom' })
  const { value: propertyRightYears } = useField<unknown>({ path: 'propertyRightYears' })
  const { value: description } = useField<unknown>({ path: 'description' })
  const { value: contactBroker } = useField<unknown>({ path: 'contactBroker' })
  const { value: merchant } = useField<unknown>({ path: 'merchant' })
  const { value: galleryValue } = useField<unknown>({ path: 'gallery' })

  const docPrice = (doc.price ?? {}) as Record<string, unknown>

  const result = useMemo(() => {
    const snapshot: ListingCompletenessSnapshot = {
      title: pick(title, doc.title),
      listingType: pick(listingType, doc.listingType),
      building: pick(building, doc.building),
      businessType: pick(businessType, doc.businessType),
      decorationStatus: pick(decorationStatus, doc.decorationStatus),
      price: {
        amount: pick(priceAmount, docPrice.amount) as number | undefined,
        currency: pick(priceCurrency, docPrice.currency) as string | undefined,
        period: pick(pricePeriod, docPrice.period) as string | undefined,
        unit: pick(priceUnit, docPrice.unit) as string | undefined,
      },
      area: pick(area, doc.area),
      floor: pick(floor, doc.floor),
      minimumLeaseMonths: pick(minimumLeaseMonths, doc.minimumLeaseMonths),
      paymentTerms: pick(paymentTerms, doc.paymentTerms),
      availableFrom: pick(availableFrom, doc.availableFrom),
      propertyRightYears: pick(propertyRightYears, doc.propertyRightYears),
      description: pick(description, doc.description),
      contactBroker: pick(contactBroker, doc.contactBroker),
      galleryCount: rowCount(galleryValue, doc.gallery),
      // OPT-034 起 `listings.merchant` 即唯一真相，不再是近似。
      hasValidMerchantRelation: pick(merchant, doc.merchant) != null,
    }
    return checkListingCompleteness(snapshot, 'submit')
  }, [
    area, availableFrom, building, businessType, contactBroker, decorationStatus, description,
    doc.area, doc.availableFrom, doc.building, doc.businessType, doc.contactBroker,
    doc.decorationStatus, doc.description, doc.floor, doc.gallery, doc.listingType,
    doc.merchant, doc.minimumLeaseMonths, doc.paymentTerms, doc.propertyRightYears,
    doc.title, docPrice.amount, docPrice.currency, docPrice.period, docPrice.unit,
    floor, galleryValue, listingType, merchant, minimumLeaseMonths, paymentTerms,
    priceAmount, priceCurrency, pricePeriod, priceUnit, propertyRightYears, title,
  ])

  // ── 保存成功但仍有缺失 → Toast 一次 ──
  // 成功保存的形态是 processing true->false 且 submitted 回落 false
  // （校验失败/请求失败时 submitted 停在 true，见 @payloadcms/ui Form）。
  const processing = useFormProcessing()
  const submitted = useFormSubmitted()
  const wasProcessingRef = useRef(false)
  const resultRef = useRef(result)

  // 判定结果只在保存完成的那一帧被读取，不参与渲染；用 effect 同步而不是
  // 渲染期写 ref（渲染期访问 ref 违反 react-hooks 规则，且并发渲染下不安全）。
  useEffect(() => {
    resultRef.current = result
  }, [result])

  useEffect(() => {
    if (processing) {
      wasProcessingRef.current = true
      return
    }
    if (wasProcessingRef.current && !submitted) {
      wasProcessingRef.current = false
      const missing = resultRef.current.missing
      if (missing.length > 0) {
        const head = missing.slice(0, 3).map((m) => m.label).join('、')
        Message.warning(
          `已保存，但还缺 ${missing.length} 项：${head}${missing.length > 3 ? ' 等' : ''}`,
        )
      }
    }
  }, [processing, submitted])

  const handleMissingClick = (item: MissingItem) => {
    const target = locateForCompletenessField(item.field)
    if (!target) return
    locateFormField(target.locateTab, target.locateFieldLabel, 'error')
  }

  const complete = result.missing.length === 0

  return (
    <div
      style={{
        border: '1px solid var(--theme-elevation-100, #e5e5e5)',
        borderRadius: 6,
        padding: '16px 20px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 14, fontWeight: 600 }}>信息完整度：</Text>
        <Tag color={complete ? 'green' : 'orange'}>{result.score}%</Tag>
        {complete ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            提交审核所需的项目都已填写
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            还缺 {result.missing.length} 项；点击任一项跳到对应字段
          </Text>
        )}
      </div>

      {!complete && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12 }}>
          {result.missing.map((item) => {
            const locatable = locateForCompletenessField(item.field) !== null
            return (
              <button
                key={item.field}
                type="button"
                disabled={!locatable}
                title={item.reason}
                aria-label={
                  locatable
                    ? `${item.label}：${item.reason}。点击跳到该字段`
                    : `${item.label}：${item.reason}`
                }
                onClick={() => handleMissingClick(item)}
                style={{
                  fontSize: 13,
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  cursor: locatable ? 'pointer' : 'default',
                  color: 'var(--theme-error-500, #f53f3f)',
                  textDecoration: locatable ? 'underline dotted' : 'none',
                  textDecorationColor: 'currentColor',
                  textUnderlineOffset: 3,
                }}
              >
                ✗ {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
