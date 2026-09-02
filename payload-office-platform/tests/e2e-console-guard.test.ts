/**
 * 守卫：断言「控制台零错误」的 E2E spec 必须拦掉 Umami 采集脚本（OPT-064）
 *
 * ## 为什么需要这条
 *
 * `quality.yml` 的 e2e job 给了构建期 `NEXT_PUBLIC_UMAMI_*`（不给的话 adapter
 * 是 Noop，埋点接线根本验不到），于是**每个前台页面**都会渲染一个指向不可达域名的
 * `<script src=".../script.js">`，浏览器真的去解析、留下一条 `ERR_NAME_NOT_RESOLVED`。
 *
 * 凡是收集 `console` 错误并断言为空的 spec，都会被这条无关错误拖红。
 *
 * 本 PR 为此红了**两轮**：第一轮撞出 city-partner-flow / detail-pages /
 * landing-pages 三个，补完再跑，第二轮又撞出 multi-city-forms /
 * multi-city-isolation 两个。一个一个撞的代价是每轮 11 分钟，
 * 而且永远不知道还有没有下一个。
 *
 * 所以把判据写成测试：**收集 console 错误 ⇒ 必须调 blockUmamiScript**。
 * 以后新写的 spec 漏了，在几秒的单测里就红，而不是十几分钟的 E2E 里。
 *
 * 只监听 `pageerror`（未捕获异常）的 spec 不在管辖范围——脚本加载失败产生的是
 * console 错误，不是 pageerror。`sale-channel.spec.ts` 属于这一类，故不要求。
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'e2e')

/** 收集 console 错误的特征：监听 console 事件并按 type() === 'error' 过滤 */
const COLLECTS_CONSOLE_ERRORS = /page\.on\(\s*'console'/

/**
 * 必须是**真实调用**，不能只是 import。
 *
 * 初版判据写的是 `source.includes('blockUmamiScript')`，结果自测时把调用删掉、
 * 只留 import，守卫照样绿——它成了自己要防的那种「看着在保护、其实什么也没验」。
 * 所以这里匹配 `blockUmamiScript(` / `stubUmami(` 这种调用形状。
 */
const CALLS_INTERCEPTOR = /(?<![\w$.])(?:blockUmamiScript|stubUmami)\s*\(/

interface SpecFile {
  name: string
  source: string
}

function readSpecs(): SpecFile[] {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((name) => ({ name, source: readFileSync(path.join(E2E_DIR, name), 'utf8') }))
}

describe('E2E 控制台断言与 Umami 脚本拦截', () => {
  const specs = readSpecs()

  it('扫到了 spec 文件（守卫本身不能空转）', () => {
    expect(specs.length).toBeGreaterThan(5)
  })

  it('收集 console 错误的 spec 都调了 blockUmamiScript', () => {
    const offenders = specs
      .filter((s) => COLLECTS_CONSOLE_ERRORS.test(s.source))
      // 去掉 import 行再判，避免「只 import 不调用」蒙混过关
      .filter((s) => !CALLS_INTERCEPTOR.test(s.source.replace(/^import .*$/gm, '')))
      .map((s) => s.name)

    expect(
      offenders,
      '这些 spec 断言控制台干净，但没拦 Umami 采集脚本——'
        + 'CI 上每页一条 ERR_NAME_NOT_RESOLVED 会把它们拖红。'
        + "在 beforeEach 里加 `await blockUmamiScript(page)`（见 tests/e2e/_umami-stub.ts）",
    ).toEqual([])
  })

  it('_umami-stub 提供的两个入口都还在（重命名会让上面那条守卫空转）', () => {
    const stub = readFileSync(path.join(E2E_DIR, '_umami-stub.ts'), 'utf8')
    expect(stub).toContain('export async function blockUmamiScript')
    expect(stub).toContain('export async function stubUmami')
  })
})
