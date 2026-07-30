import { describe, expect, it } from 'vitest'
import {
  buildInquiryMessage,
  getInquiryFocusTarget,
  reduceInquiryStep,
  resolveTargetResolution,
  validateInquiryContact,
  validateInquiryRequirements,
} from '@/components/frontend/InquiryModal'

describe('inquiry modal state helpers', () => {
  it('联系人信息不完整时停留在 contact，并返回必填错误', () => {
    const errors = validateInquiryContact({ name: '', phone: '13800001111', teamSize: '', consentAccepted: false })
    expect(errors).toEqual(['name_required', 'team_size_required', 'consent_required'])
    expect(reduceInquiryStep('contact', { type: 'continue', errors })).toBe('contact')
  })

  it('有效联系信息可前进、可返回，并在提交后进入成功', () => {
    const errors = validateInquiryContact({ name: '张三', phone: '13800001111', teamSize: '10 人', consentAccepted: true })
    expect(reduceInquiryStep('contact', { type: 'continue', errors })).toBe('requirements')
    expect(reduceInquiryStep('requirements', { type: 'back' })).toBe('contact')
    expect(reduceInquiryStep('requirements', { type: 'submitted' })).toBe('success')
  })

  it('团队规模消息精确去重并以最终消息长度为准', () => {
    expect(buildInquiryMessage('10 人', '想约看')).toBe('团队规模：10 人\n想约看')
    expect(buildInquiryMessage('10 人', '团队规模：10 人\n想约看')).toBe('团队规模：10 人\n想约看')
    expect(buildInquiryMessage('10 人', 'x'.repeat(1000))).toHaveLength(
      '团队规模：10 人\n'.length + 1000,
    )
    expect(validateInquiryRequirements({
      name: '张三',
      phone: '13800001111',
      teamSize: '10 人',
      consentAccepted: true,
      company: '',
      message: 'x'.repeat(990),
    })).toEqual([])
    expect(validateInquiryRequirements({
      name: '张三',
      phone: '13800001111',
      teamSize: '10 人',
      consentAccepted: true,
      company: '',
      message: 'x'.repeat(991),
    })).toEqual(['message_too_long'])
  })

  it('将异常 targetResolution 降级为 general，并选择步骤/错误的焦点目标', () => {
    expect(resolveTargetResolution('building')).toBe('building')
    expect(resolveTargetResolution('unexpected')).toBe('general')
    expect(getInquiryFocusTarget('contact', 'requirements', false)).toBe('requirements-heading')
    expect(getInquiryFocusTarget('requirements', 'contact', false)).toBe('contact-name')
    expect(getInquiryFocusTarget('contact', 'contact', true)).toBe('error')
  })
})
