/**
 * 三个看板闸门对通配符角色的判定（OPT-065 浏览器走查发现）
 *
 * ## 怎么发现的
 *
 * OPT-065 的页面写完，用 `e2e-adm`（平台管理员）在浏览器里点进 `/admin/analytics`，
 * 页面渲染出来的是「无权访问」。查下去不是页面的问题——`/api/overview` 本身返回
 * `403 {"ok":false,"error":"无经营概览查看权限"}`，而该账号的 `operationPermissions`
 * 是 `['*']`。
 *
 * 根因：闸门函数用裸的 `permission.operationPermissions.has(p)` 判权限，
 * 而通配符角色的集合里只有 `'*'`，没有任何具体权限码，于是恒为 false。
 * 仓库里 `hasOperationPermission()` 本就先查通配符——闸门没用它。
 *
 * 同样的写法有三处（overview / listing / lead），即三个 endpoint 对平台管理员
 * **一律 403**。之所以一直没人撞见：这三个 API 至今没有任何组件消费
 * （OPT-064 spec §2 的事实核查明确记着这一点），OPT-065 是第一个真的去调它的人。
 *
 * 对照组是现成的：`metric-context.ts` 的 `canViewMetric` 与 `field-mask.ts`
 * 都显式先判 `'*'`，写法一直是对的。所以不是设计没想到，是三处漏了。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MetricRegistry } from '@/domain/analytics/metric-registry'
import { registerBuiltinMetrics } from '@/domain/analytics/metrics/builtin'
import { canViewOverviewDashboard } from '@/domain/analytics/overview-dashboard'
import { canViewListingAnalytics } from '@/domain/analytics/listing-analytics'
import { canViewLeadAnalytics } from '@/domain/analytics/lead-analytics'
import type { PermissionContext } from '@/domain/auth/permission-context'

/** 平台管理员的真实形状：三个权限集都只有一个通配符 */
function wildcardPermission(): PermissionContext {
  return {
    userId: 1,
    roleCodes: new Set(['ADM']),
    operationPermissions: new Set(['*']),
    fieldPermissions: new Set(['*']),
    menuPermissions: new Set(['*']),
    dataScope: 'global',
    cityScope: 'all',
    teamScope: 'all',
  } as unknown as PermissionContext
}

/** 什么权限都没有的账号 */
function emptyPermission(): PermissionContext {
  return {
    userId: 2,
    roleCodes: new Set(['BRK']),
    operationPermissions: new Set<string>(),
    fieldPermissions: new Set<string>(),
    menuPermissions: new Set<string>(),
    dataScope: 'self',
    cityScope: 'all',
    teamScope: 'all',
  } as unknown as PermissionContext
}

/**
 * 单例 `metricRegistry` 只在 `payload.config.ts:140` 启动时填充，单测里是空的
 * ——空注册表下闸门也返回 false，会和「通配符没生效」长得一模一样。
 * 所以这里自建一份填满的注册表显式传进去，把两个原因分开。
 */
function makeRegistry(): MetricRegistry {
  const r = new MetricRegistry()
  registerBuiltinMetrics(r)
  return r
}

const GATES = [
  { name: 'canViewOverviewDashboard', fn: canViewOverviewDashboard },
  { name: 'canViewListingAnalytics', fn: canViewListingAnalytics },
  { name: 'canViewLeadAnalytics', fn: canViewLeadAnalytics },
] as const

describe('看板闸门必须认通配符权限', () => {
  for (const gate of GATES) {
    it(`${gate.name}：通配符角色放行`, () => {
      // 修复前这里全部返回 false —— 平台管理员被自己的看板挡在门外
      expect(gate.fn(wildcardPermission(), makeRegistry())).toBe(true)
    })
  }

  it('无任何权限的账号仍被挡（修复不能把闸门修成恒真）', () => {
    // 只断言「不是恒真」这一点：具体是否放行取决于注册表里有没有
    // requiredPermissions 为空的指标，那是注册表的事，不该由这条测试锁死。
    const results = GATES.map((g) => g.fn(emptyPermission(), makeRegistry()))
    expect(results.some((r) => r === false)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 静态守卫：防止这类写法再长出来
// ────────────────────────────────────────────────────────────

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 权限集的裸查表调用——绕过通配符的指纹 */
const RAW_LOOKUP = /\b(operationPermissions|fieldPermissions|menuPermissions)\.has\(/
/** 同一文件里若显式处理了通配符，则视为已知情（metric-context / field-mask 的写法） */
const HANDLES_WILDCARD = /\.has\(\s*(?:'\*'|"\*"|WILDCARD_PERMISSION)\s*\)/
/** 或者干脆走封装好的 helper */
const USES_HELPER = /\bhas(?:Operation|Field|Menu)Permission\s*\(/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('权限判定不得绕过通配符（静态守卫）', () => {
  it('凡是裸查权限集的文件，必须自己处理通配符或改用 helper', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      // permission-context.ts 是 helper 自己的实现，通配符逻辑就写在它里面
      if (file.endsWith(path.join('domain', 'auth', 'permission-context.ts'))) continue
      const source = readFileSync(file, 'utf8')
      if (!RAW_LOOKUP.test(source)) continue
      if (HANDLES_WILDCARD.test(source) || USES_HELPER.test(source)) continue
      offenders.push(path.relative(SRC, file))
    }

    expect(
      offenders,
      '这些文件直接查权限集但没处理通配符 `*`——'
        + '平台管理员的集合里只有 `*`、没有任何具体权限码，此类判据对其恒为 false。\n'
        + '改用 hasOperationPermission / hasFieldPermission / hasMenuPermission，'
        + '或像 metric-context.ts 那样显式先判 `*`。\n'
        + offenders.join('\n'),
    ).toEqual([])
  })
})
