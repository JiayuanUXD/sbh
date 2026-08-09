/**
 * F7.8 健康检查端点（/api/health）
 *
 * 用途：
 *   - 部署后冒烟测试（替代 /api/listings，更轻量、不依赖业务数据）
 *   - CloudRun / 负载均衡健康探针
 *   - 监控系统定期探活
 *
 * 检查项：
 *   - status: "ok" | "degraded"
 *   - checks: 各子系统状态（db, payload-init, migrations）
 *   - timestamp, version, env
 *
 * 性能：
 *   - 目标 < 50ms（不查业务表，只做轻量探测）
 *   - 无鉴权（公开端点，但不暴露敏感信息）
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type CheckStatus = 'ok' | 'fail'
type HealthStatus = 'ok' | 'degraded'

interface HealthCheck {
  db?: CheckStatus
  payload?: CheckStatus
}

interface HealthResponse {
  status: HealthStatus
  checks: HealthCheck
  timestamp: string
  /**
   * 构建该产物的 commit SHA，由 next.config.ts 在构建期内联（CI 注入 build-info.json）。
   * 灰度期间冒烟测试靠它分辨命中的是新版本还是旧版本——只看 status 无法区分，
   * 旧版本同样返回 ok（run 31275171164 的假成功即源于此）。
   * 本地开发与未注入的构建为 'unknown'。
   */
  version: string
  env: string
  region?: string
}

function getOverallStatus(checks: HealthCheck): HealthStatus {
  const values = Object.values(checks) as CheckStatus[]
  if (values.length === 0) return 'ok'
  return values.every((v) => v === 'ok') ? 'ok' : 'degraded'
}

export async function GET() {
  const checks: HealthCheck = {}
  let payloadInstance: Awaited<ReturnType<typeof getPayload>> | null = null

  try {
    payloadInstance = await getPayload({ config })
    checks.payload = 'ok'
  } catch {
    checks.payload = 'fail'
  }

  if (payloadInstance) {
    try {
      await payloadInstance.find({
        collection: 'users',
        limit: 0,
        depth: 0,
        overrideAccess: true,
      })
      checks.db = 'ok'
    } catch {
      checks.db = 'fail'
    }
  }

  const status = getOverallStatus(checks)
  const response: HealthResponse = {
    status,
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.BUILD_COMMIT ?? 'unknown',
    env: process.env.NODE_ENV ?? 'unknown',
    region: process.env.TCB_REGION ?? undefined,
  }

  const httpStatus = status === 'ok' ? 200 : 503
  return NextResponse.json(response, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
