import { describe, expect, it } from 'vitest'

import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  isLeadStage,
  canTransitionStage,
  allowedStageTransitions,
  isTerminalStage,
  requiresLossReason,
  mapLegacyStatusToStage,
} from '@/domain/crm/lead-stage'

/**
 * M5.6 线索阶段状态机纯函数单测（design §4.2 / R6）
 *
 * 主链：new → pending_assignment → following → qualified → viewing → negotiation → converted
 * 任意非终态 → lost（负向操作,须填原因）。converted / lost 为终态。
 * 公海(public_pool)是归属状态,不属于阶段,不在此状态机内。
 */

describe('lead-stage/枚举', () => {
  it('八个阶段,顺序与 design §4.2 主链一致', () => {
    expect(LEAD_STAGES).toEqual([
      'new',
      'pending_assignment',
      'following',
      'qualified',
      'viewing',
      'negotiation',
      'converted',
      'lost',
    ])
  })

  it('每个阶段都有非空中文 label', () => {
    for (const s of LEAD_STAGES) {
      expect(LEAD_STAGE_LABELS[s].trim().length).toBeGreaterThan(0)
    }
  })

  it('isLeadStage 守卫', () => {
    expect(isLeadStage('following')).toBe(true)
    expect(isLeadStage('converted')).toBe(true)
    expect(isLeadStage('public_pool')).toBe(false) // 归属状态,非阶段
    expect(isLeadStage('unknown')).toBe(false)
    expect(isLeadStage(null)).toBe(false)
    expect(isLeadStage(123)).toBe(false)
  })
})

describe('lead-stage/主链正向流转', () => {
  it('new -> pending_assignment', () => {
    expect(canTransitionStage('new', 'pending_assignment')).toBe(true)
  })
  it('pending_assignment -> following', () => {
    expect(canTransitionStage('pending_assignment', 'following')).toBe(true)
  })
  it('following -> qualified', () => {
    expect(canTransitionStage('following', 'qualified')).toBe(true)
  })
  it('qualified -> viewing', () => {
    expect(canTransitionStage('qualified', 'viewing')).toBe(true)
  })
  it('viewing -> negotiation', () => {
    expect(canTransitionStage('viewing', 'negotiation')).toBe(true)
  })
  it('negotiation -> converted', () => {
    expect(canTransitionStage('negotiation', 'converted')).toBe(true)
  })
})

describe('lead-stage/任意非终态可流失', () => {
  it('每个非终态都能 -> lost', () => {
    for (const s of LEAD_STAGES) {
      if (isTerminalStage(s)) continue
      expect(canTransitionStage(s, 'lost')).toBe(true)
    }
  })
})

describe('lead-stage/非法流转', () => {
  it('不能跳级(new 不能直达 following)', () => {
    expect(canTransitionStage('new', 'following')).toBe(false)
  })
  it('不能逆流(qualified 回 following)', () => {
    expect(canTransitionStage('qualified', 'following')).toBe(false)
  })
  it('终态 converted 无任何后继', () => {
    for (const s of LEAD_STAGES) {
      expect(canTransitionStage('converted', s)).toBe(false)
    }
  })
  it('终态 lost 无任何后继(含不能复活)', () => {
    for (const s of LEAD_STAGES) {
      expect(canTransitionStage('lost', s)).toBe(false)
    }
  })
  it('converted 不能再转 lost', () => {
    expect(canTransitionStage('converted', 'lost')).toBe(false)
  })
})

describe('lead-stage/allowedStageTransitions', () => {
  it('following 的合法目标含 qualified 与 lost', () => {
    const allowed = allowedStageTransitions('following')
    expect(allowed).toContain('qualified')
    expect(allowed).toContain('lost')
  })
  it('终态返回空集合', () => {
    expect(allowedStageTransitions('converted')).toEqual([])
    expect(allowedStageTransitions('lost')).toEqual([])
  })
})

describe('lead-stage/isTerminalStage', () => {
  it('converted 与 lost 为终态', () => {
    expect(isTerminalStage('converted')).toBe(true)
    expect(isTerminalStage('lost')).toBe(true)
  })
  it('其余非终态', () => {
    expect(isTerminalStage('new')).toBe(false)
    expect(isTerminalStage('following')).toBe(false)
    expect(isTerminalStage('negotiation')).toBe(false)
  })
})

describe('lead-stage/requiresLossReason', () => {
  it('流失(lost)必须填原因', () => {
    expect(requiresLossReason('lost')).toBe(true)
  })
  it('正向阶段不强制原因', () => {
    expect(requiresLossReason('converted')).toBe(false)
    expect(requiresLossReason('following')).toBe(false)
  })
})

describe('lead-stage/mapLegacyStatusToStage 旧 status→新 stage 映射(5.2)', () => {
  it('new -> new', () => {
    expect(mapLegacyStatusToStage('new')).toBe('new')
  })
  it('contacted -> following', () => {
    expect(mapLegacyStatusToStage('contacted')).toBe('following')
  })
  it('visited -> viewing', () => {
    expect(mapLegacyStatusToStage('visited')).toBe('viewing')
  })
  it('won -> converted', () => {
    expect(mapLegacyStatusToStage('won')).toBe('converted')
  })
  it('lost -> lost', () => {
    expect(mapLegacyStatusToStage('lost')).toBe('lost')
  })
  it('未知旧值 -> null(转人工复核,不臆测)', () => {
    expect(mapLegacyStatusToStage('weird')).toBeNull()
    expect(mapLegacyStatusToStage('')).toBeNull()
  })
})
