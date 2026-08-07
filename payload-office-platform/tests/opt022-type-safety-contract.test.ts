import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const supplyAdapterSource = readFileSync(
  resolve(process.cwd(), 'src', 'domain', 'public-catalog', 'supply-adapter.ts'),
  'utf8',
)
const measurementSource = readFileSync(
  resolve(process.cwd(), 'scripts', 'verification', 'opt022-batch-resolver-measure.ts'),
  'utf8',
)

describe('OPT-022 Payload query port type-safety contract', () => {
  it('uses the shared typed adapter instead of task-introduced type escapes', () => {
    expect(supplyAdapterSource).not.toContain(
      '(await getPayload()) as unknown as PayloadQueryPort',
    )
    expect(measurementSource).not.toMatch(/as never|as unknown as|@ts-(?:ignore|nocheck)/)
    expect(supplyAdapterSource).toContain('createEffectiveSupplyPayloadPort')
    expect(measurementSource).toContain('createEffectiveSupplyPayloadPort')
  })
})
