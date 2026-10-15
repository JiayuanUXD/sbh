import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import EmptyOutOfRange from '@/components/frontend/listing/EmptyOutOfRange'
import ViewingSlotPicker from '@/components/frontend/ViewingSlotPicker'
import { correctionErrorMessage } from '@/components/frontend/CorrectionModal'
import { getInquiryResolutionCopy, inquiryErrorMessage } from '@/components/frontend/InquiryModal'

/**
 * OPT-116：前台不出现写给开发 / 设计看的解释、调试信息和内部术语。
 * 这里守的是「曾经漏到页面上」的几处，防止回潮。
 */

describe('EmptyOutOfRange（页码越界）', () => {
  const html = renderToStaticMarkup(
    createElement(EmptyOutOfRange, {
      page: 5,
      totalPages: 3,
      lastPageHref: '/shanghai/listings?page=3',
      firstPageHref: '/shanghai/listings',
    }),
  )

  it('只讲页码不存在', () => {
    expect(html).toContain('第 5 页不存在')
  })

  // 只看用户可见文字：「去最后一页」按钮的 href 里本来就有 `?page=3`，那是正常链接。
  const visibleText = html.replace(/<[^>]+>/g, ' ')

  it('不渲染设计稿里的调试标注 page=… → 已改写为 …', () => {
    expect(visibleText).not.toContain('已改写为')
    expect(visibleText).not.toMatch(/page=\d/)
  })

  it('不再用「条件和排序都还在」这类实现说明', () => {
    expect(html).not.toContain('条件和排序都还在')
  })
})

describe('询价提交结果文案', () => {
  it.each([
    ['building', 'listing'],
    ['general', 'listing'],
    ['general', 'building'],
  ] as const)('%s / 最初咨询 %s：不出现内部术语', (resolution, requested) => {
    const copy = getInquiryResolutionCopy(resolution, requested)
    expect(copy).not.toMatch(/状态已变化|通用选址需求|同楼盘需求|已为您登记/)
    expect(copy).toContain('顾问会尽快联系您')
  })

  // PR #225 评审：列表页「提交需求」等入口本来就没有咨询对象，服务端同样返回 general；
  // 这时不能说「您咨询的房源暂时不可用」——没有任何房源失效。
  it('没有咨询对象的通用需求：只确认收到，不声称房源失效', () => {
    const copy = getInquiryResolutionCopy('general', 'none')
    expect(copy).toBe('已收到您的选址需求，顾问会尽快联系您。')
    expect(copy).not.toMatch(/不可用|变动/)
  })

  it('按最初咨询的对象说清是哪一个不可用', () => {
    expect(getInquiryResolutionCopy('general', 'listing')).toContain('您咨询的房源暂时不可用')
    expect(getInquiryResolutionCopy('general', 'building')).toContain('您咨询的楼盘暂时不可用')
  })
})

describe('inquiryErrorMessage', () => {
  it.each([
    'invalid_body',
    'invalid_json',
    'invalid_content_type',
    'body_too_large',
    'source_required',
    'source_page_type_invalid',
    'source_path_required',
    'source_path_too_long',
    'source_path_invalid',
    'request_id_required',
    'request_id_too_long',
    'campaign_invalid',
    'forbidden',
  ])('用户无法自行处理的 %s → 统一提示刷新重试', (code) => {
    expect(inquiryErrorMessage(code)).toBe('提交失败，请刷新页面后重试')
  })

  it('隐私政策版本不匹配 → 说成「隐私政策已更新」', () => {
    expect(inquiryErrorMessage('consent_version_invalid')).toBe(
      '隐私政策已更新，请刷新页面后重新提交',
    )
  })

  it('未知错误码不把英文码原样显示给用户', () => {
    expect(inquiryErrorMessage('some_new_code')).toBe('提交失败，请刷新页面后重试')
  })

  it('用户能自行修正的错误保持具体提示', () => {
    expect(inquiryErrorMessage('phone_invalid')).toBe('请填写有效的中国大陆手机号')
  })
})

describe('correctionErrorMessage（纠错弹窗）', () => {
  it.each([
    'invalid_body',
    'invalid_json',
    'invalid_content_type',
    'request_id_required',
    'request_id_too_long',
    'target_type_invalid',
    'target_slug_required',
    'target_slug_too_long',
    'forbidden',
  ])('用户无法自行处理的 %s → 统一提示刷新重试', (code) => {
    expect(correctionErrorMessage(code)).toBe('提交失败，请刷新页面后重试')
  })

  it('未知错误码不把英文码原样显示给用户', () => {
    expect(correctionErrorMessage('some_new_code')).toBe('提交失败，请刷新页面后重试')
  })

  it('用户能自行修正的错误保持具体提示', () => {
    expect(correctionErrorMessage('description_required')).toBe('请填写问题描述')
  })
})

describe('ViewingSlotPicker（看房时段）', () => {
  const html = renderToStaticMarkup(
    createElement(ViewingSlotPicker, {
      value: null,
      onChange: () => undefined,
      nowIso: '2026-10-15T02:00:00.000Z',
    }),
  )

  it('提示一句话说清：可不选、顾问会再确认', () => {
    expect(html).toContain('可不选。选好后顾问会再与您确认时间。')
  })

  it('不再重复「这不是已确认的预约」（标题已写「待顾问确认」）', () => {
    expect(html).not.toContain('这不是已确认的预约')
    expect(html).toContain('待顾问确认')
  })
})
