/**
 * 领域错误基类
 *
 * 设计原则（AGENTS.md §11）：
 *   - 不吞掉错误
 *   - 不通过 any/as any/@ts-ignore 绕过类型系统
 *   - 状态机和权限规则必须有非法路径测试
 *
 * 所有领域服务抛出的错误必须继承 DomainError，并指明：
 *   - code：稳定的机器错误码（用于前端展示、审计、重试判断）
 *   - domain：领域标签（auth / supply / crm ...）
 *   - isOperational：是否为业务可预期错误（true → 不打 5xx 告警，false → 系统异常）
 */
export type DomainTag =
  | 'auth'
  | 'geography'
  | 'supply'
  | 'review'
  | 'report'
  | 'crm'
  | 'workflow'
  | 'analytics'
  | 'audit'
  | 'dictionary'

export class DomainError extends Error {
  readonly code: string
  readonly domain: DomainTag
  readonly isOperational: boolean
  readonly details?: Record<string, unknown>

  constructor(params: {
    code: string
    domain: DomainTag
    message: string
    isOperational?: boolean
    details?: Record<string, unknown>
    cause?: unknown
  }) {
    super(params.message)
    this.name = this.constructor.name
    this.code = params.code
    this.domain = params.domain
    this.isOperational = params.isOperational ?? true
    this.details = params.details
    if (params.cause !== undefined && 'cause' in Error.prototype) {
      ;(this as { cause?: unknown }).cause = params.cause
    }
  }
}

/** 权限不足：用于 access hook / endpoint / 领域服务统一抛出。HTTP 映射 403。 */
export class ForbiddenError extends DomainError {
  constructor(params: {
    domain: DomainTag
    message?: string
    details?: Record<string, unknown>
  }) {
    super({
      code: 'FORBIDDEN',
      domain: params.domain,
      message: params.message ?? '权限不足',
      isOperational: true,
      details: params.details,
    })
  }
}

/** 资源不存在或不属于当前用户数据范围。HTTP 映射 404（不暴露存在性）。 */
export class NotFoundError extends DomainError {
  constructor(params: {
    domain: DomainTag
    resource: string
    id?: string | number
    details?: Record<string, unknown>
  }) {
    super({
      code: 'NOT_FOUND',
      domain: params.domain,
      message: `${params.resource} 不存在`,
      isOperational: true,
      details: { resource: params.resource, id: params.id, ...params.details },
    })
  }
}

/** 请求参数非法（业务规则视角，区别于 zod 层 schema 校验）。HTTP 映射 422。 */
export class InvalidOperationError extends DomainError {
  constructor(params: {
    domain: DomainTag
    code?: string
    message: string
    details?: Record<string, unknown>
  }) {
    super({
      code: params.code ?? 'INVALID_OPERATION',
      domain: params.domain,
      message: params.message,
      isOperational: true,
      details: params.details,
    })
  }
}

/** 版本冲突：旧版本写入返回 409，禁止静默覆盖（AGENTS.md §6）。 */
export class VersionConflictError extends DomainError {
  constructor(params: {
    domain: DomainTag
    resource: string
    expectedVersion: number
    actualVersion: number
    details?: Record<string, unknown>
  }) {
    super({
      code: 'VERSION_CONFLICT',
      domain: params.domain,
      message: `${params.resource} 已被他人修改，请刷新后重试`,
      isOperational: true,
      details: {
        resource: params.resource,
        expectedVersion: params.expectedVersion,
        actualVersion: params.actualVersion,
        ...params.details,
      },
    })
  }
}

/** 状态机非法转换。HTTP 映射 409。 */
export class IllegalStateTransitionError extends DomainError {
  constructor(params: {
    domain: DomainTag
    resource: string
    from: string
    to: string
    allowedTransitions: readonly string[]
    details?: Record<string, unknown>
  }) {
    super({
      code: 'ILLEGAL_TRANSITION',
      domain: params.domain,
      message: `${params.resource} 不允许从 ${params.from} 切换到 ${params.to}`,
      isOperational: true,
      details: {
        resource: params.resource,
        from: params.from,
        to: params.to,
        allowedTransitions: params.allowedTransitions,
        ...params.details,
      },
    })
  }
}
