import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FORM_SUBMISSION_STATUSES,
  FORM_SUBMISSION_DEFAULT_COLUMNS,
  appendFormSubmissionStatusFields,
  canTransitionFormSubmissionStatus,
  formSubmissionUpdateAccess,
  protectFormSubmissionStatus,
} from '@/domain/forms/submission-status'

const here = fileURLToPath(new URL('.', import.meta.url))
const migrationPath = resolve(
  here,
  '../src/migrations/20260728_181000_opt_021_form_submission_status.ts',
)

describe('form submission processing status', () => {
  it('declares the stable processing status values', () => {
    expect(FORM_SUBMISSION_STATUSES).toEqual(['new', 'processing', 'processed'])
  })

  it('allows a new submission to be claimed for processing', () => {
    expect(canTransitionFormSubmissionStatus('new', 'processing')).toBe(true)
  })

  it('allows a processing submission to be completed', () => {
    expect(canTransitionFormSubmissionStatus('processing', 'processed')).toBe(true)
  })

  it('allows a processing submission to be returned to the new queue', () => {
    expect(canTransitionFormSubmissionStatus('processing', 'new')).toBe(true)
  })

  it('does not allow a processed submission to return directly to new', () => {
    expect(canTransitionFormSubmissionStatus('processed', 'new')).toBe(false)
  })
})

describe('form submission status fields', () => {
  it('appends server-owned processing fields after plugin defaults', () => {
    const formField = {
      name: 'form',
      type: 'relationship',
      relationTo: 'forms',
    } as const

    const fields = appendFormSubmissionStatusFields({ defaultFields: [formField] })

    expect(fields.map((field) => 'name' in field && field.name)).toEqual([
      'form',
      'processingStatus',
      'processedAt',
      'processedBy',
    ])
    expect(fields[1]).toMatchObject({
      name: 'processingStatus',
      type: 'select',
      defaultValue: 'new',
      required: true,
      index: true,
    })
    expect(fields[2]).toMatchObject({
      name: 'processedAt',
      type: 'date',
      admin: { readOnly: true },
    })
    expect(fields[3]).toMatchObject({
      name: 'processedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    })
  })

  it('defines the operational list columns in the requested order', () => {
    expect(FORM_SUBMISSION_DEFAULT_COLUMNS).toEqual([
      'form',
      'processingStatus',
      'createdAt',
      'processedBy',
    ])
  })
})

describe('form submission plugin configuration', () => {
  it('wires the processing fields, columns and protection hook into the generated collection', async () => {
    const { default: configPromise } = await import('@/payload.config')
    const config = await configPromise
    const submissions = config.collections.find(
      (collection) => collection.slug === 'form-submissions',
    )

    expect(submissions).toBeDefined()
    expect(submissions?.fields.map((field) => 'name' in field && field.name)).toEqual(
      expect.arrayContaining(['processingStatus', 'processedAt', 'processedBy']),
    )
    expect(submissions?.admin.defaultColumns).toEqual(FORM_SUBMISSION_DEFAULT_COLUMNS)
    expect(submissions?.hooks?.beforeChange).toContain(protectFormSubmissionStatus)
  })
})

describe('form submission update access', () => {
  function makeAccessArgs(menuPermissions: string[]) {
    return {
      req: {
        user: {
          id: 42,
          status: 'active',
          sessionVersion: 1,
          cityScope: [],
          roles: [
            {
              id: 7,
              code: 'OPS',
              status: 'active',
              dataScope: 'global',
              menuPermissions,
              operationPermissions: [],
              fieldPermissions: [],
            },
          ],
        },
        payload: {
          find: vi.fn(),
        },
      },
    }
  }

  it('allows authenticated staff with form submission menu permission to update status', async () => {
    await expect(
      formSubmissionUpdateAccess(
        makeAccessArgs(['form-submissions']) as never,
      ),
    ).resolves.toBe(true)
  })

  it('denies authenticated users without form submission permission', async () => {
    await expect(
      formSubmissionUpdateAccess(makeAccessArgs(['listings']) as never),
    ).resolves.toBe(false)
  })

  it('denies anonymous updates', async () => {
    await expect(
      formSubmissionUpdateAccess({
        req: { user: null },
      } as never),
    ).resolves.toBe(false)
  })
})

describe('form submission status migration', () => {
  function readMigration(): string {
    return readFileSync(migrationPath, 'utf8')
  }

  it('adds nullable columns, backfills new, then enforces the default and not-null status', () => {
    const migration = readMigration()
    const addStatus = migration.indexOf(
      `ALTER TABLE "form_submissions" ADD COLUMN "processing_status" "enum_form_submissions_processing_status";`,
    )
    const backfill = migration.indexOf(
      `UPDATE "form_submissions" SET "processing_status" = 'new' WHERE "processing_status" IS NULL;`,
    )
    const setDefault = migration.indexOf(
      `ALTER TABLE "form_submissions" ALTER COLUMN "processing_status" SET DEFAULT 'new';`,
    )
    const setNotNull = migration.indexOf(
      `ALTER TABLE "form_submissions" ALTER COLUMN "processing_status" SET NOT NULL;`,
    )

    expect(migration).toContain(
      `CREATE TYPE "public"."enum_form_submissions_processing_status" AS ENUM('new', 'processing', 'processed');`,
    )
    expect(addStatus).toBeGreaterThanOrEqual(0)
    expect(addStatus).toBeLessThan(backfill)
    expect(backfill).toBeLessThan(setDefault)
    expect(setDefault).toBeLessThan(setNotNull)
  })

  it('adds processor metadata, its foreign key and operational indexes', () => {
    const migration = readMigration()

    expect(migration).toContain(
      `ALTER TABLE "form_submissions" ADD COLUMN "processed_at" timestamp(3) with time zone;`,
    )
    expect(migration).toContain(
      `ALTER TABLE "form_submissions" ADD COLUMN "processed_by_id" integer;`,
    )
    expect(migration).toContain(
      `ADD CONSTRAINT "form_submissions_processed_by_id_users_id_fk" FOREIGN KEY ("processed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`,
    )
    expect(migration).toContain(
      `CREATE INDEX "form_submissions_processing_status_idx" ON "form_submissions" USING btree ("processing_status");`,
    )
    expect(migration).toContain(
      `CREATE INDEX "form_submissions_processed_by_idx" ON "form_submissions" USING btree ("processed_by_id");`,
    )
  })

  it('drops dependent indexes and constraint before columns and enum on rollback', () => {
    const migration = readMigration()
    const down = migration.slice(migration.indexOf('export async function down'))
    const dropStatusIndex = down.indexOf(
      `DROP INDEX "form_submissions_processing_status_idx";`,
    )
    const dropProcessorIndex = down.indexOf(
      `DROP INDEX "form_submissions_processed_by_idx";`,
    )
    const dropConstraint = down.indexOf(
      `DROP CONSTRAINT "form_submissions_processed_by_id_users_id_fk";`,
    )
    const dropStatus = down.indexOf(`DROP COLUMN "processing_status";`)
    const dropType = down.indexOf(
      `DROP TYPE "public"."enum_form_submissions_processing_status";`,
    )

    expect(dropStatusIndex).toBeGreaterThanOrEqual(0)
    expect(dropProcessorIndex).toBeGreaterThanOrEqual(0)
    expect(dropConstraint).toBeGreaterThan(dropProcessorIndex)
    expect(dropStatus).toBeGreaterThan(dropConstraint)
    expect(dropType).toBeGreaterThan(dropStatus)
  })
})

describe('form submission status beforeChange hook', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('forces public creates to new and clears forged processing metadata', async () => {
    const result = await protectFormSubmissionStatus({
      operation: 'create',
      data: {
        processingStatus: 'processed',
        processedAt: '2026-01-01T00:00:00.000Z',
        processedBy: 999,
      },
      req: { user: null },
    } as never)

    expect(result).toMatchObject({
      processingStatus: 'new',
      processedAt: null,
      processedBy: null,
    })
  })

  it('derives processed metadata from the current user on completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T10:35:00.000Z'))

    const result = await protectFormSubmissionStatus({
      operation: 'update',
      originalDoc: {
        processingStatus: 'processing',
        processedAt: null,
        processedBy: null,
      },
      data: {
        processingStatus: 'processed',
        processedAt: '2026-01-01T00:00:00.000Z',
        processedBy: 999,
      },
      req: { user: { id: 42 } },
    } as never)

    expect(result).toMatchObject({
      processingStatus: 'processed',
      processedAt: '2026-07-28T10:35:00.000Z',
      processedBy: 42,
    })
  })

  it('clears processed metadata when a completed submission is reopened', async () => {
    const result = await protectFormSubmissionStatus({
      operation: 'update',
      originalDoc: {
        processingStatus: 'processed',
        processedAt: '2026-07-28T10:35:00.000Z',
        processedBy: 42,
      },
      data: {
        processingStatus: 'processing',
      },
      req: { user: { id: 7 } },
    } as never)

    expect(result).toMatchObject({
      processingStatus: 'processing',
      processedAt: null,
      processedBy: null,
    })
  })

  it('discards forged metadata when processed status is unchanged', async () => {
    const result = await protectFormSubmissionStatus({
      operation: 'update',
      originalDoc: {
        processingStatus: 'processed',
        processedAt: '2026-07-28T10:35:00.000Z',
        processedBy: 42,
      },
      data: {
        processedAt: '2026-01-01T00:00:00.000Z',
        processedBy: 999,
      },
      req: { user: { id: 7 } },
    } as never)

    expect(result).not.toHaveProperty('processedAt')
    expect(result).not.toHaveProperty('processedBy')
  })

  it('rejects processed to new even if the caller supplies processing metadata', async () => {
    await expect(
      protectFormSubmissionStatus({
        operation: 'update',
        originalDoc: {
          processingStatus: 'processed',
          processedAt: '2026-07-28T10:35:00.000Z',
          processedBy: 42,
        },
        data: {
          processingStatus: 'new',
          processedAt: null,
          processedBy: null,
        },
        req: { user: { id: 42 } },
      } as never),
    ).rejects.toThrow(/不允许从 processed 切换到 new/)
  })

  it('rejects completion without a current user to attribute it to', async () => {
    await expect(
      protectFormSubmissionStatus({
        operation: 'update',
        originalDoc: { processingStatus: 'processing' },
        data: { processingStatus: 'processed' },
        req: { user: null },
      } as never),
    ).rejects.toThrow(/当前登录用户/)
  })

  it('rejects unknown statuses instead of accepting client input', async () => {
    await expect(
      protectFormSubmissionStatus({
        operation: 'update',
        originalDoc: { processingStatus: 'new' },
        data: { processingStatus: 'forged-status' },
        req: { user: { id: 42 } },
      } as never),
    ).rejects.toThrow(/处理状态无效/)
  })

  it('fails closed when an update has no original document', async () => {
    await expect(
      protectFormSubmissionStatus({
        operation: 'update',
        originalDoc: undefined,
        data: { processingStatus: 'processing' },
        req: { user: { id: 42 } },
      } as never),
    ).rejects.toThrow(/原始记录/)
  })
})
