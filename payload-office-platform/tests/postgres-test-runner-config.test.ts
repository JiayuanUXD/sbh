import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const applicationRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(applicationRoot, '..')

describe('PostgreSQL 回归套件执行配置', () => {
  it('按文件串行执行共享测试库用例，并让 CI 复用同一命令', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(applicationRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const workflow = await readFile(
      resolve(repositoryRoot, '.github/workflows/quality.yml'),
      'utf8',
    )

    expect(packageJson.scripts?.['test:postgres']).toBe(
      'vitest run tests/*-postgres.test.ts --no-file-parallelism',
    )
    expect(workflow).toContain('run: pnpm test:postgres')
    expect(workflow).not.toContain('run: pnpm exec vitest run tests/*-postgres.test.ts')
  })
})
