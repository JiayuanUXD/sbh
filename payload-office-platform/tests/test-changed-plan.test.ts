/**
 * 守卫：pre-push 只跑受影响单测的选取规则，以及它赖以成立的三处接线
 *
 * ## 为什么需要这条
 *
 * `.githooks/pre-push` 从「全量 `pnpm test`」改成「`pnpm test:changed`」之后，本地闸门跑哪些
 * 测试由 `scripts/lib/test-changed-plan.mjs` 的几条规则决定：
 *
 *   - 哪些文件一改就退回全量（vitest.config / package.json / pnpm-lock）；
 *   - 什么样的测试算「读源码的契约测试」而**常驻**——它们守的文件不在 import 图里，
 *     `vitest related` 永远选不中，而它们恰恰守的是「不报错、只是静默失效」的回归。
 *
 * 这两条规则改错了不会有任何报错，只是 pre-push 从此静默少跑一批守卫，直到 CI 才红（或者
 * 根本不红——契约测试守的正是 CI 也测不到的东西）。真实例子：脚本首版的判据只认 `*Sync`，
 * 17 个用 `fs/promises` 的 `readFile(` / `readdir(` 的守卫（client-components-no-server-imports、
 * sale-channel-always-on、frontend-shell-hydration……）从一开始就没进过 pre-push，
 * 是本文件初写时扫真实 `tests/` 目录才发现的。所以第 9 条直接扫真实目录点名。
 *
 * 另外三处接线各自也有「静默失效」的形态，一并钉住：
 *
 *   - `vitest.config.ts` 没有 DATABASE_URL 时不收集 `tests/*-postgres.test.ts`。判据若与
 *     用例内的 `databaseAvailable` 不一致，或有真库套件没按 `-postgres` 命名，结果都是
 *     「本地白付 6~8s 冷加载」或「CI 的 postgres-migrations 作业按路径点不到它」——后者意味着
 *     那份套件在任何地方都不跑。
 *   - `quality.yml` 的 postgres-migrations 步骤必须带 `--passWithNoTests=false`：
 *     配置层已经会在没库时把这些文件整个排除，步骤若被挪到没库的作业里会一个都选不中，
 *     没有这个开关就是静默绿。
 *   - `pre-push` 默认要调 `pnpm test:changed`，`FULL_PREPUSH=1` 才全量；`package.json`
 *     要真的声明这个脚本，否则 hook 里 `pnpm test:changed` 直接报 missing script。
 *
 * 本文件自己也用 readFileSync 读源码，因此按同一判据它是常驻的——改坏判据时它会当场红。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { configDefaults } from 'vitest/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CONTRACT_RE,
  FULL_RUN_TRIGGERS,
  MAX_CHANGED,
  collectContractTests,
  fullRunReason,
  isContractTest,
  normalizeChanged,
  parseGitLines,
  vitestMode,
} from '../scripts/lib/test-changed-plan.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..')
const testsDir = resolve(appRoot, 'tests')

/** 统一成 LF：根目录没有 .gitattributes，autocrlf=true 的 Windows 克隆会把 hook / yml 写成 CRLF。 */
const read = (rel: string, root = appRoot) =>
  readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n')

/** 真库套件的排除模式。vitest.config 与 quality.yml 必须用同一个字面量。 */
const POSTGRES_GLOB = 'tests/*-postgres.test.ts'

describe('test-changed 的纯决策逻辑（scripts/lib/test-changed-plan.mjs）', () => {
  it('parseGitLines：LF 与 CRLF 都能切行，去掉空行与首尾空白', () => {
    expect(parseGitLines('a.ts\nb.ts\n')).toEqual(['a.ts', 'b.ts'])
    expect(parseGitLines('a.ts\r\n  b.ts \r\n\r\n')).toEqual(['a.ts', 'b.ts'])
    expect(parseGitLines('')).toEqual([])
    // -z 的 NUL 分隔：中文 / 带引号的路径只有这样才拿得到原样（默认 core.quotePath 会 C 转义）
    expect(parseGitLines('tests/中文契约.test.ts\0src/a "b".ts\0')).toEqual(['tests/中文契约.test.ts', 'src/a "b".ts'])
  })

  it('normalizeChanged：去重，并丢掉已不存在的路径（删除 / 改名走掉的文件）', () => {
    const exists = (f: string) => f !== 'src/gone.ts'
    expect(normalizeChanged(['src/a.ts', 'src/gone.ts', 'src/a.ts', 'tests/x.test.ts'], exists)).toEqual([
      'src/a.ts',
      'tests/x.test.ts',
    ])
  })

  it('fullRunReason：三个触发器任一在应用目录根下改动即退回全量', () => {
    // 清单本身也钉住：少一个就是有人把「import 图可能变了」的情形放过去了
    expect([...FULL_RUN_TRIGGERS].sort()).toEqual(['package.json', 'pnpm-lock.yaml', 'vitest.config.ts'])
    for (const trigger of FULL_RUN_TRIGGERS) {
      const reason = fullRunReason(['src/a.ts', trigger])
      expect(reason, trigger).not.toBeNull()
      expect(reason).toContain(trigger)
    }
  })

  it('fullRunReason：子目录里的同名文件不触发，改动为空或只有普通文件返回 null', () => {
    expect(fullRunReason([])).toBeNull()
    expect(fullRunReason(['src/a.ts', 'tests/a.test.ts'])).toBeNull()
    expect(fullRunReason(['scripts/package.json', 'tests/fixtures/vitest.config.ts'])).toBeNull()
  })

  it('fullRunReason：以 - 开头的文件名退回全量（会被 vitest 当成选项，--dir=x 能让它静默绿）', () => {
    expect(fullRunReason(['src/a.ts', '--dir=nope'])).toContain('--dir=nope')
    expect(fullRunReason(['-u'])).not.toBeNull()
    expect(fullRunReason(['src/-not-an-option.ts'])).toBeNull() // 只看整个路径的首字符
  })

  it('vitestMode：改动含 tests/ 之外的文件才需要 related 重建依赖图，否则 run', () => {
    expect(vitestMode([])).toBe('run')
    expect(vitestMode(['tests/a.test.ts', 'tests/helpers/x.ts'])).toBe('run')
    expect(vitestMode(['tests/a.test.ts', 'src/a.ts'])).toBe('related')
  })

  it('fullRunReason：改动数刚好等于上限不退回，超过 1 个就退回并带上数量', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `src/f${i}.ts`)
    expect(fullRunReason(many(MAX_CHANGED))).toBeNull()
    const reason = fullRunReason(many(MAX_CHANGED + 1))
    expect(reason).toContain(String(MAX_CHANGED + 1))
    expect(reason).toContain(String(MAX_CHANGED))
  })

  it('isContractTest：同步与 fs/promises 的读文件 / 列目录 / glob 调用都算', () => {
    const positives = [
      "const s = readFileSync(resolve(ROOT, 'a.ts'), 'utf8')",
      'const names = fs.readdirSync(dir)',
      "for (const f of globSync('src/**/*.tsx')) {}",
      "const s = await readFile(join(process.cwd(), rel), 'utf8')",
      'const entries = await readdir(FRONTEND, { withFileTypes: true })',
      "const files = await glob('src/**/*.ts')",
      'readFileSync (p)', // 调用括号前有空格也算
      'expect(existsSync(file), `${file} 存在会让抽屉每次导航都被重挂`).toBe(false)', // 「不该存在」的守卫
    ]
    for (const src of positives) expect(isContractTest(src), src).toBe(true)
  })

  it('isContractTest：stat / 只 import 不调用 / 前缀相似的标识符都不算', () => {
    const negatives = [
      'const info = await stat(file)',
      "import { readFileSync } from 'node:fs'", // 只 import，没调用
      'const readFileSyncCount = 3',
      'myReadFileSync(x)', // 前面粘着别的标识符
      'const x = readFileSyncX(p)',
      '', // 空文件
    ]
    for (const src of negatives) expect(isContractTest(src), src).toBe(false)
    // 判据是导出常量，脚本与本测试共用同一个；顺手钉住它的形状
    expect(CONTRACT_RE.source).toContain('readFileSync')
    expect(CONTRACT_RE.source).toContain('readFile')
    expect(CONTRACT_RE.source).toContain('readdir')
  })

  it('collectContractTests：只看顶层 *.test.ts、按判据筛、返回带 tests/ 前缀的相对路径', () => {
    const files: Record<string, string> = {
      'a-contract.test.ts': "readFileSync(resolve(ROOT, 'x'), 'utf8')",
      'b-pure.test.ts': "import { foo } from '@/lib/foo'\nexpect(foo()).toBe(1)",
      'c-promises.test.ts': "await readFile(p, 'utf8')",
      'd.spec.ts': 'readFileSync(p)', // Playwright spec，不归 vitest
      'helper.ts': 'readFileSync(p)', // 不是测试
    }
    const fake = {
      readdirSync: (dir: string) => {
        expect(dir).toBe('/fake/tests')
        return Object.keys(files)
      },
      readFileSync: (file: string) => files[file.replace(/^.*[\\/]/, '')] ?? '',
    }
    expect(collectContractTests('/fake/tests', fake)).toEqual([
      'tests/a-contract.test.ts',
      'tests/c-promises.test.ts',
    ])
  })

  it('扫真实 tests/ 目录：已知的 fs 读源码守卫全部常驻（Sync 型、fs/promises 型、本文件）', () => {
    const contract = collectContractTests(testsDir)
    // 守卫本身不能空转
    expect(contract.length).toBeGreaterThan(40)
    const mustInclude = [
      // *Sync 型
      'tests/production-deploy-config.test.ts',
      'tests/preflight-migrations.test.ts',
      'tests/admin-nav-hidden-selectors.test.ts',
      'tests/e2e-console-guard.test.ts',
      // fs/promises 型——脚本首版漏掉的那一类
      'tests/client-components-no-server-imports.test.ts',
      'tests/sale-channel-always-on.test.ts',
      'tests/frontend-shell-hydration.test.ts',
      'tests/nav-target-pool-coverage.test.ts',
      // existsSync 型——断言 loading.tsx 不存在
      'tests/opt036-listings-view-wiring.test.ts',
      // 本文件
      'tests/test-changed-plan.test.ts',
    ]
    for (const f of mustInclude) expect(contract, f).toContain(f)
  })

  it('tests/ 下没有嵌套的 *.test.ts（契约扫描、-postgres 排除、chdir 守卫都只看顶层，vitest include 却是递归的）', () => {
    const nested = readdirSync(testsDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.test.ts') && /[\\/]/.test(f))
    expect(nested).toEqual([])
  })

  it('扫真实 tests/ 目录：纯 import 图型的单测不在常驻名单里', () => {
    const contract = collectContractTests(testsDir)
    // 这几份只 import 被测模块，`vitest related` 按图就能选中，不该常驻
    for (const f of [
      'tests/seed-target-guard.test.ts',
      'tests/supply-import-batch-rollback.test.ts',
      'tests/media-delete-cache-invalidation.test.ts',
    ]) {
      expect(contract, f).not.toContain(f)
    }
  })
})

describe('test:changed 的接线', () => {
  it('package.json 声明 test:changed，入口脚本是 lib 的薄调用方', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['test:changed']).toBe('node scripts/test-changed.mjs')
    expect(pkg.scripts.test).toBe('vitest run')

    const script = read('scripts/test-changed.mjs')
    expect(script).toContain("from './lib/test-changed-plan.mjs'")
    // 决策逻辑不许在入口脚本里再长出一份副本，否则测的和跑的不是同一套
    expect(script).not.toMatch(/const (FULL_RUN_TRIGGERS|CONTRACT_RE|MAX_CHANGED)\s*=/)
    // related 与契约测试混排、一次 vitest 调用；只改 tests/ 时走 run
    expect(script).toContain("['related', '--run', ...changed, ...contract]")
    expect(script).toContain("['run', ...changed, ...contract]")
    // git 输出用 -z 拿原样路径；有删除即退回全量
    expect(script).toContain("git('diff', '--name-only', '--relative', '-z', base)")
    expect(script).toContain("git('ls-files', '--others', '--exclude-standard', '-z')")
    expect(script).toContain("'--diff-filter=D'")
    // linked worktree 里 hook 环境带 GIT_DIR，会让 -C appDir 把应用目录当顶层；必须剥掉
    for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) expect(script).toContain(`'${v}'`)
    expect(script).toContain('env: gitEnv')
    // vitest 入口走 package.json 的 bin 字段
    expect(script).not.toContain("'vitest.mjs'")
  })

  it('pre-push 默认跑 pnpm test:changed，FULL_PREPUSH=1 才全量，SKIP_PREPUSH=1 直接放行', () => {
    const hook = read('.githooks/pre-push', repoRoot)

    expect(hook).toContain('[ "${SKIP_PREPUSH:-0}" = "1" ] && exit 0')

    const typecheck = hook.indexOf('pnpm typecheck ||')
    const fullBranch = hook.indexOf('if [ "${FULL_PREPUSH:-0}" = "1" ]; then')
    const elseBranch = hook.indexOf('else', fullBranch)
    expect(typecheck).toBeGreaterThanOrEqual(0)
    expect(fullBranch).toBeGreaterThan(typecheck)
    expect(elseBranch).toBeGreaterThan(fullBranch)

    const fullBody = hook.slice(fullBranch, elseBranch)
    const elseBody = hook.slice(elseBranch)
    expect(fullBody).toContain('pnpm test ||')
    expect(fullBody).not.toContain('pnpm test:changed')
    expect(elseBody).toContain('pnpm test:changed ||')
    expect(elseBody).not.toMatch(/pnpm test \|\|/)
    // 禁止 --no-verify 的红线仍在
    expect(hook).toContain('禁止用 --no-verify 绕过')
  })
})

describe('vitest.config 对真库套件的收集开关', () => {
  const ORIGINAL = process.env.DATABASE_URL

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = ORIGINAL
  })

  interface LoadedConfig {
    test?: { exclude?: string[]; pool?: string; include?: string[] }
  }

  async function loadConfigWith(databaseUrl: string | undefined): Promise<LoadedConfig> {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
    const mod = (await import('../vitest.config')) as unknown as { default: LoadedConfig }
    return mod.default
  }

  it('没有 DATABASE_URL：排除 tests/*-postgres.test.ts，且保留 vitest 默认排除项', async () => {
    const cfg = await loadConfigWith(undefined)
    expect(cfg.test?.exclude).toContain(POSTGRES_GLOB)
    for (const d of configDefaults.exclude) expect(cfg.test?.exclude).toContain(d)
  })

  it('DATABASE_URL 是 postgres 连接串：不排除', async () => {
    const cfg = await loadConfigWith('postgres://payload:payload@127.0.0.1:5432/payload_m0')
    expect(cfg.test?.exclude).not.toContain(POSTGRES_GLOB)
    expect(cfg.test?.exclude).toEqual(configDefaults.exclude)
  })

  it('DATABASE_URL 不是 postgres 前缀（如 file:./dev.db）：仍排除，判据与用例内 databaseAvailable 一致', async () => {
    const cfg = await loadConfigWith('file:./dev.db')
    expect(cfg.test?.exclude).toContain(POSTGRES_GLOB)
    const empty = await loadConfigWith('')
    expect(empty.test?.exclude).toContain(POSTGRES_GLOB)
  })

  it('每个用 databaseAvailable 自我禁用的真库套件都以 -postgres.test.ts 命名，且都在 tests/ 顶层', () => {
    // 否则：本地 pnpm test 白付 6~8s 冷加载，CI 的 postgres-migrations 作业按路径也点不到它——
    // 那份套件就哪儿都不跑了。
    const dbSuites = readdirSync(testsDir)
      .filter((f) => f.endsWith('.test.ts'))
      .filter((f) => /describe\.skipIf\(\s*!databaseAvailable\s*\)/.test(read(`tests/${f}`)))
    expect(dbSuites.length).toBeGreaterThanOrEqual(8)
    for (const f of dbSuites) expect(f, f).toMatch(/-postgres\.test\.ts$/)

    // 反向：叫 -postgres 的也都真的自我禁用了（否则没库时 CI 之外的全量跑会直接炸）
    const named = readdirSync(testsDir).filter((f) => f.endsWith('-postgres.test.ts'))
    expect(named.sort()).toEqual(dbSuites.sort())
    for (const f of named) {
      expect(read(`tests/${f}`), f).toMatch(/process\.env\.DATABASE_URL\.startsWith\('postgres'\)/)
    }
  })

  it('线程池：pool 为 threads，且 tests/ 里没有线程不支持的 process.chdir', async () => {
    const cfg = await loadConfigWith(undefined)
    expect(cfg.test?.pool).toBe('threads')
    const offenders = readdirSync(testsDir)
      .filter((f) => f.endsWith('.test.ts'))
      .filter((f) => /process\.chdir\s*\(/.test(read(`tests/${f}`)))
    expect(offenders).toEqual([])
  })
})

describe('quality.yml 的真库回归步骤', () => {
  const yml = read('.github/workflows/quality.yml', repoRoot)

  /** 取某个 job 的整段（到下一个顶层 job 或文件末尾）。 */
  function jobBlock(name: string): string {
    const start = yml.indexOf(`\n  ${name}:\n`)
    expect(start, `job ${name} 不存在`).toBeGreaterThanOrEqual(0)
    const rest = yml.slice(start + 1)
    const next = rest.slice(1).search(/\n  [\w-]+:\s*\n/)
    return next < 0 ? rest : rest.slice(0, next + 1)
  }

  it('postgres-migrations 作业带 DATABASE_URL，步骤显式 --passWithNoTests=false 并按同一模式点名', () => {
    const job = jobBlock('postgres-migrations')
    expect(job).toMatch(/^\s+DATABASE_URL: postgres:\/\//m)
    expect(job).toContain(`run: pnpm exec vitest run --pool=forks --passWithNoTests=false ${POSTGRES_GLOB}`)
    // 排除模式的字面量在 vitest.config 里也必须是同一个，两处才指向同一批文件
    expect(read('vitest.config.ts')).toContain(`'${POSTGRES_GLOB}'`)
  })

  it('真库步骤只在 postgres-migrations 作业里，跑 pnpm test 的 quality 作业不带 DATABASE_URL', () => {
    // quality 作业若带上 DATABASE_URL，配置层就会把 8 个真库套件收进 pnpm test，
    // 而那个作业没有 migrate + seed 过的库。
    const quality = jobBlock('quality')
    expect(quality).toContain('run: pnpm test\n')
    expect(quality).not.toMatch(/^\s+DATABASE_URL:/m)
    expect(quality).not.toContain('--passWithNoTests=false')
    const e2e = jobBlock('e2e')
    expect(e2e).not.toContain('--passWithNoTests=false')
  })
})
