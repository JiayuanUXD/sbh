/**
 * `domain/shared/unique-violation.ts` 单测
 *
 * 守护不变量：
 *   - 适配器把 23505 转成的 ValidationError 能被判到（本项目实际路径）
 *   - 只按 tableName 收窄，不依赖 i18n 文案
 *   - path 作为加强条件：null 放行（自建索引），不同的非空 path 拒绝
 *   - 表名不匹配 → false（不会把别的表的冲突吞成自己的幂等成功）
 *   - 非唯一约束的 ValidationError（普通字段校验失败）→ false
 *   - 裸 pg 23505 分支保留（裸 SQL 路径），且仍按 marker 收窄
 *   - 无关错误 / null / 循环 cause → false，不抛异常
 *
 * fixture 的真实形状来源见 tests/helpers/unique-violation-fixtures.ts 文件头。
 */

import { describe, expect, it } from 'vitest'
import { ValidationError } from 'payload'

import { isUniqueViolation } from '@/domain/shared/unique-violation'
import {
  adapterUniqueViolation,
  cityPartnerUniqueViolation,
  correctionUniqueViolation,
  leadsUniqueViolation,
  notificationUniqueViolation,
  payloadJobUniqueViolation,
  rawPostgresUniqueViolation,
  supplySubmissionUniqueViolation,
} from './helpers/unique-violation-fixtures'

describe('isUniqueViolation / 适配器 ValidationError 分支（本项目实际路径）', () => {
  it('六处调用点各自的真实错误形状都能判到', () => {
    expect(isUniqueViolation(leadsUniqueViolation(), {
      tableName: 'leads', column: 'idempotency_key',
    })).toBe(true)
    expect(isUniqueViolation(supplySubmissionUniqueViolation(), {
      tableName: 'supply_submissions', column: 'idempotency_key', path: 'idempotencyKey',
    })).toBe(true)
    expect(isUniqueViolation(correctionUniqueViolation(), {
      tableName: 'information_corrections', column: 'idempotency_key', path: 'idempotencyKey',
    })).toBe(true)
    expect(isUniqueViolation(cityPartnerUniqueViolation(), {
      tableName: 'city_partner_applications', column: 'idempotency_key', path: 'idempotencyKey',
    })).toBe(true)
    expect(isUniqueViolation(notificationUniqueViolation(), {
      tableName: 'notifications', column: 'event_id',
    })).toBe(true)
    expect(isUniqueViolation(payloadJobUniqueViolation(), {
      tableName: 'payload_jobs',
    })).toBe(true)
  })

  it('回归：只查 cause.code === 23505 的老写法对这个形状恒为 false', () => {
    // 这条断言就是本次修复的起因：适配器重建的 ValidationError 整条 cause 链上没有 code。
    const error = leadsUniqueViolation()
    let candidate: unknown = error
    let sawCode = false
    for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
      const record = candidate as Record<string, unknown>
      if (record.code === '23505') sawCode = true
      candidate = record.cause
    }
    expect(sawCode).toBe(false)
    expect(isUniqueViolation(error, { tableName: 'leads' })).toBe(true)
  })

  it('不依赖 i18n 文案：英文环境的 message 同样判得到', () => {
    const english = new ValidationError({
      collection: 'leads',
      errors: [{ message: 'Value must be unique', path: null, tableName: 'leads' } as never],
    })
    expect(isUniqueViolation(english, { tableName: 'leads' })).toBe(true)
  })

  it('表名不匹配 → false', () => {
    expect(isUniqueViolation(leadsUniqueViolation(), { tableName: 'notifications' })).toBe(false)
    expect(isUniqueViolation(notificationUniqueViolation(), { tableName: 'payload_jobs' })).toBe(false)
  })

  it('path 为加强条件：null 放行，不同的非空 path 拒绝', () => {
    // 自建索引映射不回字段 → path 为 null，仍应放行
    expect(isUniqueViolation(
      adapterUniqueViolation('leads', 'leads', null),
      { tableName: 'leads', path: 'idempotencyKey' },
    )).toBe(true)
    // 同表另一个唯一字段冲突 → 拒绝，避免被吞成幂等成功
    expect(isUniqueViolation(
      adapterUniqueViolation('leads', 'leads', 'someOtherUniqueField'),
      { tableName: 'leads', path: 'idempotencyKey' },
    )).toBe(false)
  })

  it('多条 errors 时任一命中即可', () => {
    const multi = new ValidationError({
      collection: 'leads',
      errors: [
        { message: '必填', path: 'phone' } as never,
        { message: '值必须是唯一的', path: null, tableName: 'leads' } as never,
      ],
    })
    expect(isUniqueViolation(multi, { tableName: 'leads' })).toBe(true)
  })

  it('普通字段校验失败的 ValidationError（没有 tableName）→ false', () => {
    const plain = new ValidationError({
      collection: 'leads',
      errors: [{ message: '此字段是必填项', path: 'phone' } as never],
    })
    expect(isUniqueViolation(plain, { tableName: 'leads' })).toBe(false)
  })
})

describe('isUniqueViolation / 裸 pg 分支（裸 SQL 路径）', () => {
  it('约束名含表名时判到', () => {
    const error = rawPostgresUniqueViolation(
      'city_partner_applications_idempotency_key_idx',
      'Key (idempotency_key)=(abc) already exists.',
    )
    expect(isUniqueViolation(error, { tableName: 'city_partner_applications' })).toBe(true)
  })

  it('约束名不含表名但 detail 含列名时靠 column 判到', () => {
    // notifications 的复合索引叫 eventId_recipient_type_idx，约束名里没有表名
    const error = rawPostgresUniqueViolation(
      'eventId_recipient_type_idx',
      'Key (event_id, recipient_id, type)=(e1, 2, x) already exists.',
    )
    expect(isUniqueViolation(error, { tableName: 'notifications', column: 'event_id' })).toBe(true)
  })

  it('包在 cause 链里也能判到', () => {
    const wrapped = Object.assign(new Error('DrizzleQueryError'), {
      cause: rawPostgresUniqueViolation(
        'leads_idempotency_key_uniq_idx',
        'Key (idempotency_key)=(abc) already exists.',
      ),
    })
    expect(isUniqueViolation(wrapped, { tableName: 'leads' })).toBe(true)
  })

  it('23505 但 marker 指向别的表 → false', () => {
    const error = rawPostgresUniqueViolation(
      'buildings_slug_idx',
      'Key (slug)=(abc) already exists.',
    )
    expect(isUniqueViolation(error, { tableName: 'leads', column: 'idempotency_key' })).toBe(false)
  })

  it('其它 SQLSTATE → false', () => {
    const fk = Object.assign(new Error('fk violation'), {
      code: '23503',
      constraint: 'leads_city_id_fk',
      detail: 'Key (city_id)=(9) is not present.',
    })
    expect(isUniqueViolation(fk, { tableName: 'leads' })).toBe(false)
  })
})

describe('isUniqueViolation / 边界输入', () => {
  it('null / undefined / 字符串 / 普通 Error → false，且不抛异常', () => {
    for (const input of [null, undefined, 'boom', 42, new Error('boom')]) {
      expect(isUniqueViolation(input, { tableName: 'leads' })).toBe(false)
    }
  })

  it('自引用的 cause 链不会死循环', () => {
    const looped = new Error('loop') as Error & { cause?: unknown }
    looped.cause = looped
    expect(isUniqueViolation(looped, { tableName: 'leads' })).toBe(false)
  })
})
