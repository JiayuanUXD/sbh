/**
 * 守卫：E2E 里的隐私政策版本副本必须与常量同步
 *
 * ## 为什么需要这条
 *
 * E2E spec 不走 `@/` 别名，只能把 `PRIVACY_POLICY_VERSION` 抄一份。
 * 而服务端对该值是**精确匹配**——`version !== PRIVACY_POLICY_VERSION` 即拒绝
 * （`supply-submission/schema.ts` 与 `inquiry/schema.ts` 都是这个判据）。
 *
 * 于是副本一旦漂移，**所有提交表单的 E2E 用例全部 422**，
 * 而**本地闸门只跑 typecheck + test，完全看不见**——只有 CI 才会红。
 * OPT-067 升版本时就漂了一次。
 *
 * 这条把它拉回单测层：几百毫秒就红，而不是等十几分钟的 E2E。
 * 同款做法见 `admin-nav-leaf-coverage.test.ts`（守 E2E 的导航叶子清单）。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('隐私政策版本：E2E 副本与常量同步', () => {
  it('frontend-journey.spec.ts 的 CONSENT_POLICY_VERSION 等于当前常量', () => {
    const source = readFileSync(path.join(HERE, 'e2e', 'frontend-journey.spec.ts'), 'utf8')
    const match = /const CONSENT_POLICY_VERSION = '([^']+)'/.exec(source)

    expect(match, '未找到 CONSENT_POLICY_VERSION 声明——它被改名或删了，本守卫会空转').not.toBeNull()
    expect(
      match?.[1],
      '隐私政策版本变了但 E2E 副本没跟上。服务端精确匹配该值，'
        + '不同步会让所有提交表单的 E2E 用例 422，且只在 CI 才暴露。',
    ).toBe(PRIVACY_POLICY_VERSION)
  })

  it('仓库里不存在其它写死的隐私同意版本字面量（CRM 策略版本除外）', () => {
    // `MVP_R1_POLICY.runtime_policy_version` 是 **CRM 运行时策略快照**版本，
    // 与隐私政策完全无关，不在管辖范围——两者恰好都叫 MVP-Rx，容易混淆。
    const offenders: string[] = []
    const files = [
      path.join(HERE, 'e2e', 'frontend-journey.spec.ts'),
      path.join(HERE, 'supply-submission-api-route.test.ts'),
    ]
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      // 只揪 consent 上下文里的字面量；CRM 快照那类不匹配
      if (/policyVersion:\s*'MVP-R\d'/.test(source)) {
        offenders.push(path.basename(file))
      }
    }
    expect(
      offenders,
      '这些文件在 consent 里写死了版本字面量，应改用 PRIVACY_POLICY_VERSION',
    ).toEqual([])
  })
})
