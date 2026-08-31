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
  // 跨领域的系统级故障（事务被回滚等），不属于任何业务域
  | 'system'

export class DomainError extends Error {
  readonly code: string
  readonly domain: DomainTag
  readonly isOperational: boolean
  readonly details?: Record<string, unknown>

  /**
   * Payload 的 `isErrorPublic()` 判据（OPT-052）。
   *
   * ## 为什么需要它，而 `domainErrorAfterError` 不够
   *
   * `payload-after-error.ts` 的 `afterError` 钩子已经把 DomainError 映射成
   * 正确的状态码与文案——**但它只在 `routeError` 兜底那条路径上生效**。
   *
   * Payload 的**批量操作**（`deleteMany` / `updateMany`）自己 catch 每一条错误：
   *
   * ```js
   * // payload/dist/collections/operations/delete.js:223
   * const isPublic = error instanceof Error ? isErrorPublic(error, config) : false
   * errors.push({ id: doc.id, isPublic, message: ... })
   * ```
   *
   * 这发生在 `afterError` **之前**，钩子根本轮不到。而 `isErrorPublic` 的判据是：
   * `isPublic === true` → 放行；`status && status !== 500` → 放行；否则一律替换成
   * 「Something went wrong.」。DomainError 两个都没有，直接落到兜底。
   *
   * 真实教训（OPT-050）：后台批量删楼盘时守卫确实拦住了，但运营看到的仍然是
   * 「Something went wrong.」——而 10 条单测全绿，因为它们断言的是「抛了什么错」，
   * 而缺陷在于「错误怎么被序列化给客户端」。
   *
   * ## 为什么绑定到 `isOperational` 而不是无条件 true
   *
   * `isOperational: true` 的定义就是「业务可预期错误」——这类消息本来就是写给
   * 用户看的（「楼盘下还有 N 套房源」「已被他人修改」）。
   *
   * 而 `isOperational: false` 表示系统异常，其 message 可能来自底层库，
   * 含连接串、堆栈、表结构。**那些绝不能给用户看**，所以保持 `isPublic: false`
   * 让 Payload 继续兜底——这也正是 Payload 默认隐藏的原因。
   *
   * 上线前已逐条复核 `src/domain` 下全部 221 条去重后的错误消息：
   * 无连接串、无密钥、无文件路径、无堆栈、无原始错误对象拼接。
   */
  readonly isPublic: boolean

  /**
   * HTTP 状态码，供 `isErrorPublic` 的第二条判据与批量操作使用。
   *
   * 与 `payload-after-error.ts` 的 `STATUS_BY_CLASS` 保持同一套映射——
   * 两处都改才不会漂。子类各自覆写；基类默认 400（业务错误，不是服务端故障）。
   * **绝不能用 500**：`isErrorPublic` 对 500 视为内部错误、照样隐藏消息，
   * 而且会让业务规则进错误告警。
   */
  readonly status: number

  constructor(params: {
    code: string
    domain: DomainTag
    message: string
    isOperational?: boolean
    details?: Record<string, unknown>
    cause?: unknown
    status?: number
  }) {
    super(params.message)
    this.name = this.constructor.name
    this.code = params.code
    this.domain = params.domain
    this.isOperational = params.isOperational ?? true
    this.details = params.details
    this.isPublic = this.isOperational
    this.status = params.status ?? 400
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
      // 与 payload-after-error.ts 的 STATUS_BY_CLASS 同源，两处都改才不会漂
      status: 403,
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
      // 与 payload-after-error.ts 的 STATUS_BY_CLASS 同源，两处都改才不会漂
      status: 404,
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
      // 与 payload-after-error.ts 的 STATUS_BY_CLASS 同源，两处都改才不会漂
      status: 422,
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
      // 与 payload-after-error.ts 的 STATUS_BY_CLASS 同源，两处都改才不会漂
      status: 409,
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
      // 与 payload-after-error.ts 的 STATUS_BY_CLASS 同源
      status: 409,
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
