import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import payload, {
  createLocalReq,
  type CollectionBeforeChangeHook,
  type Field,
  type PayloadRequest,
  type SanitizedCollectionConfig,
} from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FORM_SUBMISSION_DEFAULT_COLUMNS,
  FORM_SUBMISSION_STATUSES,
  appendFormSubmissionStatusFields,
  canTransitionFormSubmissionStatus,
  formSubmissionUpdateAccess,
  protectFormSubmissionStatus,
} from '@/domain/forms/submission-status'
import type { FormSubmission, Role, User } from '@/payload-types'

const here = fileURLToPath(new URL('.', import.meta.url))
const migrationPath = resolve(
  here,
  '../src/migrations/20260728_181000_opt_021_form_submission_status.ts',
)
const { default: configPromise } = await import('@/payload.config')
const payloadConfig = await configPromise
payload.config = payloadConfig

function requireFormSubmissionCollection(): SanitizedCollectionConfig {
  const collection = payloadConfig.collections.find(
    (candidate) => candidate.slug === 'form-submissions',
  )
  if (!collection) {
    throw new Error('form-submissions collection is not configured')
  }
  return collection
}

function makeRole(menuPermissions: string[]): Role {
  return {
    id: 7,
    code: 'OPS',
    name: '运营',
    status: 'active',
    dataScope: 'global',
    menuPermissions,
    operationPermissions: [],
    fieldPermissions: [],
    updatedAt: '2026-07-28T00:00:00.000Z',
    createdAt: '2026-07-28T00:00:00.000Z',
  }
}

function makeUser(menuPermissions: string[] = ['form-submissions']): User {
  return {
    id: 42,
    name: '处理人',
    email: 'operator@example.com',
    status: 'active',
    roles: [makeRole(menuPermissions)],
    cityScope: [],
    sessionVersion: 1,
    updatedAt: '2026-07-28T00:00:00.000Z',
    createdAt: '2026-07-28T00:00:00.000Z',
    collection: 'users',
  }
}

async function makeRequest(user: User | null): Promise<PayloadRequest> {
  return user
    ? createLocalReq({ user }, payload)
    : createLocalReq({}, payload)
}

function makeSubmission(
  overrides: Partial<FormSubmission> = {},
): FormSubmission {
  return {
    id: 100,
    form: 9,
    submissionData: [{ field: 'email', value: 'customer@example.com', id: 'email' }],
    processingStatus: 'new',
    processedAt: null,
    processedBy: null,
    updatedAt: '2026-07-28T00:00:00.000Z',
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  }
}

type FormSubmissionHookArgs = Parameters<
  CollectionBeforeChangeHook<FormSubmission>
>[0]

async function makeHookArgs(params: {
  data: Partial<FormSubmission>
  operation: 'create' | 'update'
  originalDoc?: FormSubmission
  user?: User | null
  forgeIdOnlyUser?: boolean
}): Promise<FormSubmissionHookArgs> {
  const user = params.user === undefined ? makeUser() : params.user
  const req = await makeRequest(user)
  if (params.forgeIdOnlyUser) {
    Reflect.set(req, 'user', { id: 42 })
  }

  return {
    collection: requireFormSubmissionCollection(),
    context: {},
    data: params.data,
    operation: params.operation,
    originalDoc: params.originalDoc,
    req,
  }
}

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
    const formField: Field = {
      name: 'form',
      type: 'relationship',
      relationTo: 'forms',
    }
    const submissionDataField: Field = {
      name: 'submissionData',
      type: 'array',
      fields: [
        { name: 'field', type: 'text' },
        { name: 'value', type: 'text' },
      ],
    }

    const fields = appendFormSubmissionStatusFields({
      defaultFields: [formField, submissionDataField],
    })

    expect(fields.map((field) => 'name' in field && field.name)).toEqual([
      'form',
      'submissionData',
      'processingStatus',
      'processedAt',
      'processedBy',
    ])
    expect(fields[2]).toMatchObject({
      name: 'processingStatus',
      type: 'select',
      defaultValue: 'new',
      required: true,
      index: true,
    })
    expect(fields[3]).toMatchObject({
      name: 'processedAt',
      type: 'date',
      admin: { readOnly: true },
    })
    expect(fields[4]).toMatchObject({
      name: 'processedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    })
  })

  it('denies field-level updates to form and submissionData facts', async () => {
    const req = await makeRequest(makeUser())
    const fields = appendFormSubmissionStatusFields({
      defaultFields: requireFormSubmissionCollection().fields.filter(
        (field) => 'name' in field && (field.name === 'form' || field.name === 'submissionData'),
      ),
    })

    for (const fieldName of ['form', 'submissionData']) {
      const field = fields.find(
        (candidate) => 'name' in candidate && candidate.name === fieldName,
      )
      if (!field || !('access' in field) || !field.access?.update) {
        throw new Error(`${fieldName} is missing field-level update access`)
      }
      expect(await field.access.update({ req })).toBe(false)
    }
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
  it('wires the processing fields, columns and protection hook into the generated collection', () => {
    const submissions = requireFormSubmissionCollection()

    expect(submissions.fields.map((field) => 'name' in field && field.name)).toEqual(
      expect.arrayContaining(['processingStatus', 'processedAt', 'processedBy']),
    )
    expect(submissions.admin.defaultColumns).toEqual(FORM_SUBMISSION_DEFAULT_COLUMNS)
    expect(submissions.hooks?.beforeChange).toContain(protectFormSubmissionStatus)
  })
})

describe('form submission update access', () => {
  it('allows authenticated staff with form submission menu permission to update status', async () => {
    const req = await makeRequest(makeUser(['form-submissions']))
    await expect(formSubmissionUpdateAccess({ req })).resolves.toBe(true)
  })

  it('denies authenticated users without form submission permission', async () => {
    const req = await makeRequest(makeUser(['listings']))
    await expect(formSubmissionUpdateAccess({ req })).resolves.toBe(false)
  })

  it('denies anonymous updates', async () => {
    const req = await makeRequest(null)
    await expect(formSubmissionUpdateAccess({ req })).resolves.toBe(false)
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
    const args = await makeHookArgs({
      operation: 'create',
      data: {
        processingStatus: 'processed',
        processedAt: '2026-01-01T00:00:00.000Z',
        processedBy: 999,
      },
      user: null,
    })
    const result = await protectFormSubmissionStatus(args)

    expect(result).toMatchObject({
      processingStatus: 'new',
      processedAt: null,
      processedBy: null,
    })
  })

  it('derives processed metadata from the current user on completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T10:35:00.000Z'))
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission({ processingStatus: 'processing' }),
      data: {
        processingStatus: 'processed',
        processedAt: '2026-01-01T00:00:00.000Z',
        processedBy: 999,
      },
    })
    const result = await protectFormSubmissionStatus(args)

    expect(result).toMatchObject({
      processingStatus: 'processed',
      processedAt: '2026-07-28T10:35:00.000Z',
      processedBy: 42,
    })
  })

  it('clears processed metadata when a completed submission is reopened', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission({
        processingStatus: 'processed',
        processedAt: '2026-07-28T10:35:00.000Z',
        processedBy: 42,
      }),
      data: { processingStatus: 'processing' },
    })
    const result = await protectFormSubmissionStatus(args)

    expect(result).toMatchObject({
      processingStatus: 'processing',
      processedAt: null,
      processedBy: null,
    })
  })

  it('discards forged metadata when processed status is unchanged', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission({
        processingStatus: 'processed',
        processedAt: '2026-07-28T10:35:00.000Z',
        processedBy: 42,
      }),
      data: {
        processedAt: '2026-01-01T00:00:00.000Z',
        processedBy: 999,
      },
    })
    const result = await protectFormSubmissionStatus(args)

    expect(result).not.toHaveProperty('processedAt')
    expect(result).not.toHaveProperty('processedBy')
  })

  it('rejects processed to new even if the caller supplies processing metadata', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission({
        processingStatus: 'processed',
        processedAt: '2026-07-28T10:35:00.000Z',
        processedBy: 42,
      }),
      data: {
        processingStatus: 'new',
        processedAt: null,
        processedBy: null,
      },
    })

    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(
      /不允许从 processed 切换到 new/,
    )
  })

  it('rejects completion without a current user to attribute it to', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission({ processingStatus: 'processing' }),
      data: { processingStatus: 'processed' },
      user: null,
    })
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/权限/)
  })

  it('rejects an update by a user without form submission permission', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission(),
      data: { processingStatus: 'processing' },
      user: makeUser(['listings']),
    })
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/权限/)
  })

  it('rejects an update by a forged id-only request user', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission(),
      data: { processingStatus: 'processing' },
      user: null,
      forgeIdOnlyUser: true,
    })
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/权限/)
  })

  it('ignores a forged cached permission context and rebuilds from req.user', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission(),
      data: { processingStatus: 'processing' },
      user: null,
      forgeIdOnlyUser: true,
    })
    Reflect.set(args.req, '__permissionContext', {
      userId: 42,
      roleCodes: ['ADM'],
      cityIds: 'all',
      teamIds: 'all',
      operationPermissions: new Set(['*']),
      fieldPermissions: new Set(['*']),
      menuPermissions: new Set(['*']),
      dataScope: 'global',
    })

    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/权限/)
  })

  it('rejects form tampering even for an authorized user', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission({ form: 9 }),
      data: { form: 10 },
    })
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/表单.*不可修改/)
  })

  it('rejects submissionData tampering even for an authorized user', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission(),
      data: {
        submissionData: [{ field: 'email', value: 'attacker@example.com', id: 'email' }],
      },
    })
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(
      /提交内容.*不可修改/,
    )
  })

  it('allows unchanged fact fields and removes them from the update payload', async () => {
    const originalDoc = makeSubmission()
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc,
      data: {
        form: originalDoc.form,
        submissionData: originalDoc.submissionData,
        processingStatus: 'processing',
      },
    })
    const result = await protectFormSubmissionStatus(args)

    expect(result).not.toHaveProperty('form')
    expect(result).not.toHaveProperty('submissionData')
    expect(result).toMatchObject({ processingStatus: 'processing' })
  })

  it('rejects unknown statuses instead of accepting client input', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      originalDoc: makeSubmission(),
      data: {},
    })
    Reflect.set(args.data, 'processingStatus', 'forged-status')
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/处理状态无效/)
  })

  it('fails closed when an update has no original document', async () => {
    const args = await makeHookArgs({
      operation: 'update',
      data: { processingStatus: 'processing' },
    })
    await expect(protectFormSubmissionStatus(args)).rejects.toThrow(/原始记录/)
  })
})
