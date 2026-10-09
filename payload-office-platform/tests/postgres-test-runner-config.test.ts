import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const applicationRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(applicationRoot, '..')

describe('PostgreSQL 回归套件执行配置', () => {
  it('本地按文件串行，CI 同时强制进程池、禁止空跑与串行执行', async () => {
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
    expect(workflow).toContain(
      'run: pnpm exec vitest run --pool=forks --passWithNoTests=false --no-file-parallelism tests/*-postgres.test.ts',
    )
  })
})
