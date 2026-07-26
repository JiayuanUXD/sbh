/**
 * 指标注册表（tasks.md M7.1 / R7）
 *
 * 职责：
 *   - 注册 / 查找 / 列出指标定义
 *   - 按权限上下文过滤可见指标（M7.2 工作台使用）
 *   - 执行查询适配器，返回单值或序列
 *   - 缓存（M7.3+ 接入；M7.1 阶段不缓存，cacheTtlMs 仅元数据）
 *
 * 业务不变量：
 *   - 编码唯一，重复注册抛错
 *   - query 适配器失败时抛 Error，由调用方捕获标记局部失败
 *   - 不允许绕过注册表直接调用 query
 */

import type { PermissionContext } from '@/domain/auth/permission-context'
import { canViewMetric } from './metric-context'
import {
  isMetricDefinition,
  type MetricCategory,
  type MetricCode,
  type MetricDefinition,
  type MetricQueryContext,
  type MetricQueryResult,
} from './metric-types'

/** 重复注册错误 */
export class DuplicateMetricError extends Error {
  constructor(code: MetricCode) {
    super(`Metric already registered: ${code}`)
    this.name = 'DuplicateMetricError'
  }
}

/** 指标未找到错误 */
export class MetricNotFoundError extends Error {
  constructor(code: MetricCode) {
    super(`Metric not found: ${code}`)
    this.name = 'MetricNotFoundError'
  }
}

/** 指标无权限错误 */
export class MetricPermissionError extends Error {
  constructor(code: MetricCode, userId: number | string) {
    super(`User ${userId} has no permission to view metric: ${code}`)
    this.name = 'MetricPermissionError'
  }
}

/**
 * 指标注册表（线程不安全；MVP 单进程足够）。
 *
 * 使用方式：
 *   ```ts
 *   import { metricRegistry } from '@/domain/analytics'
 *   import { registerBuiltinMetrics } from '@/domain/analytics/metrics/builtin'
 *
 *   registerBuiltinMetrics(metricRegistry)  // 启动时注册一次
 *
 *   const result = await metricRegistry.resolve('listings.total', ctx)
 *   ```
 */
export class MetricRegistry {
  private readonly metrics = new Map<MetricCode, MetricDefinition>()

  /** 注册指标；重复 code 抛 DuplicateMetricError */
  register(def: MetricDefinition): void {
    if (!isMetricDefinition(def)) {
      const code = (def as { code?: unknown })?.code
      const codeStr = typeof code === 'string' ? code : '<unknown>'
      throw new Error(`Invalid metric definition: ${codeStr}`)
    }
    if (this.metrics.has(def.code)) {
      throw new DuplicateMetricError(def.code)
    }
    this.metrics.set(def.code, def)
  }

  /** 是否已注册 */
  has(code: MetricCode): boolean {
    return this.metrics.has(code)
  }

  /** 获取指标定义；不存在返回 undefined */
  get(code: MetricCode): MetricDefinition | undefined {
    return this.metrics.get(code)
  }

  /** 获取指标定义；不存在抛 MetricNotFoundError */
  require(code: MetricCode): MetricDefinition {
    const def = this.metrics.get(code)
    if (!def) throw new MetricNotFoundError(code)
    return def
  }

  /** 已注册的指标编码列表 */
  codes(): MetricCode[] {
    return [...this.metrics.keys()]
  }

  /**
   * 按权限上下文与可选分类过滤可见指标。
   *
   * - 跳过 deprecated 指标
   * - 跳过无权限指标
   * - 按 category 过滤（可选）
   */
  listVisible(
    permission: PermissionContext,
    filter?: { category?: MetricCategory },
  ): MetricDefinition[] {
    const result: MetricDefinition[] = []
    for (const def of this.metrics.values()) {
      if (def.deprecated) continue
      if (!canViewMetric(permission, def)) continue
      if (filter?.category && def.category !== filter.category) continue
      result.push(def)
    }
    return result
  }

  /**
   * 解析指标。
   *
   * 步骤：
   *   1. 查找指标定义（不存在抛 MetricNotFoundError）
   *   2. 校验权限（无权限抛 MetricPermissionError）
   *   3. 调用 query 适配器
   *
   * 注意：本方法不捕获 query 抛出的错误，调用方需 try/catch 标记局部失败。
   */
  async resolve(
    code: MetricCode,
    ctx: MetricQueryContext,
  ): Promise<MetricQueryResult> {
    const def = this.require(code)
    if (!canViewMetric(ctx.permission, def)) {
      throw new MetricPermissionError(code, ctx.permission.userId)
    }
    return def.query(ctx)
  }

  /** 清空注册表（仅供测试使用） */
  clear(): void {
    this.metrics.clear()
  }
}

/** 单例注册表（应用启动时由 registerBuiltinMetrics 填充） */
export const metricRegistry = new MetricRegistry()
