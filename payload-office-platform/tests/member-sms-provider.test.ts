import { describe, expect, it } from 'vitest'
import {
  collectSmsProductionViolations,
  expandTemplateParams,
  resolveSmsProvider,
} from '@/domain/member/sms-provider'

describe('sms-provider', () => {
  it('模板占位展开', () => {
    expect(expandTemplateParams(undefined, '123456', 5)).toEqual(['123456', '5'])
    expect(expandTemplateParams('{code}', '123456', 5)).toEqual(['123456'])
    expect(expandTemplateParams('{minutes},{code}', '1', 5)).toEqual(['5', '1'])
  })
  it('非生产缺省 console；fixture 可选；生产未配返回 null', () => {
    expect(resolveSmsProvider({ NODE_ENV: 'development' }, () => {})?.name).toBe('console')
    expect(
      resolveSmsProvider({ NODE_ENV: 'test', SMS_PROVIDER: 'fixture' }, () => {})?.name,
    ).toBe('fixture')
    expect(resolveSmsProvider({ NODE_ENV: 'production' }, () => {})).toBeNull()
  })
  it('tencent 缺凭据抛错，凭据齐全返回 tencent', () => {
    expect(() =>
      resolveSmsProvider({ NODE_ENV: 'development', SMS_PROVIDER: 'tencent' }, () => {}),
    ).toThrow(/TENCENT_SMS/)
    const full = {
      NODE_ENV: 'development',
      SMS_PROVIDER: 'tencent',
      TENCENT_SMS_SECRET_ID: 'a',
      TENCENT_SMS_SECRET_KEY: 'b',
      TENCENT_SMS_SDK_APP_ID: '1400',
      TENCENT_SMS_SIGN_NAME: '签名',
      TENCENT_SMS_TEMPLATE_ID: '1',
    }
    expect(resolveSmsProvider(full, () => {})?.name).toBe('tencent')
  })
  it('生产拒绝 console / fixture，允许 tencent；CI 环境允许 fixture', () => {
    expect(
      collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'console' }),
    ).toHaveLength(1)
    expect(
      collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture' }),
    ).toHaveLength(1)
    expect(
      collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture', CI: '1' }),
    ).toEqual([])
    expect(
      resolveSmsProvider({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture', CI: '1' }, () => {})?.name,
    ).toBe('fixture')
    expect(
      resolveSmsProvider({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture' }, () => {}),
    ).toBeNull()
    expect(
      collectSmsProductionViolations({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'tencent',
        TENCENT_SMS_SECRET_ID: 'a',
        TENCENT_SMS_SECRET_KEY: 'b',
        TENCENT_SMS_SDK_APP_ID: '1',
        TENCENT_SMS_SIGN_NAME: 's',
        TENCENT_SMS_TEMPLATE_ID: 't',
      }),
    ).toEqual([])
    expect(collectSmsProductionViolations({ NODE_ENV: 'production' })).toEqual([])
  })
})
