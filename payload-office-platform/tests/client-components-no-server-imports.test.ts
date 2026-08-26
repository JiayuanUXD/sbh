/**
 * `'use client'` 组件不得引入服务端专用模块
 *
 * ## 被守护的事故
 *
 * OPT-053 实施时，`SiteFooter.tsx`（`'use client'`）从 `@/lib/frontend/site-settings`
 * 取了一个类型和一个纯函数。那个模块里有 `getPayload` 与 `@/payload.config` 的 import，
 * 于是 Turbopack 把整条依赖链拉进浏览器包，`next build` 失败：
 *
 *   Turbopack build failed with 57 errors:
 *   ./node_modules/.pnpm/sharp@0.34.4/node_modules/sharp/lib/sharp.js
 *   non-ecmascript placeable asset
 *
 * **`typecheck` 与 3800+ 单测全绿**——这类错误只有 `next build` 才会暴露，而 build
 * 只在 CI 的 e2e job 里跑，反馈要等好几分钟。本文件把它拉到单测这一层。
 *
 * 判据是「import 了什么」而不是「叫什么名字」：只要客户端组件的 import 图里出现
 * 服务端专用模块，就算命名再无辜也会炸。
 */
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * 服务端专用模块。客户端组件直接或间接 import 它们即为不合法。
 *
 * 这里只列**根源**：payload 运行时与它的 config。中间模块（如
 * `lib/frontend/site-settings.ts`）由下面的传递闭包自动覆盖，不用手工维护清单——
 * 手工清单必然漂移，而漂移的后果是守卫静默失效。
 */
const SERVER_ONLY_ROOTS = ['payload', '@/payload.config']

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

/**
 * 抽出一个文件的**值** import 说明符。
 *
 * 刻意跳过 `import type` / `export type`：TypeScript 在编译期就把它们擦掉，
 * 根本到不了打包器。不跳过的话本守卫会把 `src/components/admin/` 下一大批
 * 一直正常工作的组件判成违规——它们对 payload 的引用全是 `import type { Where }`
 * 这种纯类型引用。
 *
 * 混合写法（`import { fn, type T }`）算值 import，因为它确实产生运行时依赖——
 * OPT-053 炸掉 build 的正是这一种。
 */
function importSpecifiers(source: string): string[] {
  const out: string[] = []
  const re = /^\s*(?:import|export)(\s+type)?[\s\S]*?from\s+['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[1]) continue // `import type ...` / `export type ...`：编译期擦除
    out.push(m[2])
  }
  return out
}

/** `@/x/y` → 绝对路径候选；相对路径同理。非本地模块返回 null。 */
function resolveLocal(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@/')) return resolve(SRC, spec.slice(2))
  if (spec.startsWith('.')) return resolve(fromFile, '..', spec)
  return null
}

async function readIfExists(base: string): Promise<string | null> {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      return await readFile(candidate, 'utf8')
    } catch {
      // 试下一个后缀
    }
  }
  return null
}

describe("'use client' 组件不得把服务端模块拖进浏览器包", () => {
  // 显式 60s：本用例遍历 src/ 下每个文件并做 import 传递闭包，是 I/O 密集型。
  // 单独跑 0.6s，但全量并行时实测撞到过 vitest 默认的 5s 上限（5015ms），
  // 表现为超时而非断言失败——那是"机器忙"，不该被读成"守卫红了"。
  // 同族问题见工作项 OPT-056（supply-public-cache-hook 的动态 import 超时）。
  it('客户端组件的 import 传递闭包里不出现 payload 运行时', async () => {
    const files = await walk(SRC)
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (!/^\s*['"]use client['"]/.test(source)) continue

      // 从该客户端组件出发做一次传递闭包，遇到服务端根即记违规并给出链路
      const seen = new Set<string>()
      const queue: Array<{ base: string; chain: string[] }> = [
        { base: file.replace(/\.(ts|tsx)$/, ''), chain: [file.replace(SRC, 'src/')] },
      ]

      while (queue.length > 0) {
        const { base, chain } = queue.shift()!
        if (seen.has(base)) continue
        seen.add(base)
        const content = base === file.replace(/\.(ts|tsx)$/, '') ? source : await readIfExists(base)
        if (content === null) continue

        for (const spec of importSpecifiers(content)) {
          if (SERVER_ONLY_ROOTS.includes(spec)) {
            violations.push(`${chain.join(' → ')} → ${spec}`)
            continue
          }
          const local = resolveLocal(spec, `${base}.ts`)
          if (local) queue.push({ base: local, chain: [...chain, spec] })
        }
      }
    }

    expect(
      violations,
      `以下客户端组件会把 payload 运行时拉进浏览器包（next build 会以 sharp 的\n` +
        `non-ecmascript placeable asset 失败，但 typecheck 与单测都发现不了）：\n` +
        violations.join('\n'),
    ).toEqual([])
  }, 60_000)
})
