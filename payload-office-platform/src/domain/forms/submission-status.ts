import { isDeepStrictEqual } from 'node:util'

import type {
  CollectionBeforeChangeHook,
  CollectionConfig,
  Field,
} from 'payload'

import { derivePermissionContextFromRequest } from '@/domain/auth/access'
import { hasMenuPermission } from '@/domain/auth/permission-context'
import type { FormSubmission } from '@/payload-types'

export const FORM_SUBMISSION_STATUSES = ['new', 'processing', 'processed'] as const

export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number]

export const FORM_SUBMISSION_DEFAULT_COLUMNS = [
  'form',
  'processingStatus',
  'createdAt',
  'processedBy',
] as const

type ImmutableFactField = Extract<
  Field,
  { type: 'array' | 'relationship' }
>

function isImmutableFactField(field: Field): field is ImmutableFactField {
  return (
    'name' in field &&
    ((field.name === 'form' && field.type === 'relationship') ||
      (field.name === 'submissionData' && field.type === 'array'))
  )
}

export function appendFormSubmissionStatusFields({
  defaultFields,
}: {
  defaultFields: Field[]
}): Field[] {
  return [
    ...defaultFields.map((field) => {
      if (!isImmutableFactField(field)) {
        return field
      }

      return {
        ...field,
        access: {
          ...field.access,
          update: () => false,
        },
      }
    }),
    {
      name: 'processingStatus',
      type: 'select',
      label: '处理状态',
      defaultValue: 'new',
      required: true,
      index: true,
      options: [
        { label: '新提交', value: 'new' },
        { label: '处理中', value: 'processing' },
        { label: '已处理', value: 'processed' },
      ],
    },
    {
      name: 'processedAt',
      type: 'date',
      label: '处理时间',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'processedBy',
      type: 'relationship',
      label: '处理人',
      relationTo: 'users',
      admin: {
        readOnly: true,
      },
    },
  ]
}

type FormSubmissionUpdateAccess = NonNullable<
  NonNullable<CollectionConfig['access']>['update']
>

export const formSubmissionUpdateAccess: FormSubmissionUpdateAccess = async ({
  req,
}) => {
  const permission = await derivePermissionContextFromRequest(req)
  return Boolean(
    permission && hasMenuPermission(permission, 'form-submissions'),
  )
}

const FORM_SUBMISSION_STATUS_TRANSITIONS: Readonly<
  Record<FormSubmissionStatus, readonly FormSubmissionStatus[]>
> = {
  new: ['processing'],
  processing: ['new', 'processed'],
  processed: ['processing'],
}

export function isFormSubmissionStatus(value: unknown): value is FormSubmissionStatus {
  return (
    typeof value === 'string' &&
    FORM_SUBMISSION_STATUSES.some((status) => status === value)
  )
}

export function canTransitionFormSubmissionStatus(
  from: FormSubmissionStatus,
  to: FormSubmissionStatus,
): boolean {
  return from === to || FORM_SUBMISSION_STATUS_TRANSITIONS[from].includes(to)
}

export class FormSubmissionStatusError extends Error {
  readonly code:
    | 'FORM_SUBMISSION_STATUS_INVALID'
    | 'FORM_SUBMISSION_STATUS_TRANSITION_INVALID'
    | 'FORM_SUBMISSION_ORIGINAL_REQUIRED'
    | 'FORM_SUBMISSION_PROCESSOR_REQUIRED'
    | 'FORM_SUBMISSION_UPDATE_FORBIDDEN'
    | 'FORM_SUBMISSION_FACT_IMMUTABLE'

  constructor(
    code: FormSubmissionStatusError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'FormSubmissionStatusError'
    this.code = code
  }
}

function getCurrentStatus(originalDoc: FormSubmission | undefined): FormSubmissionStatus {
  const status = originalDoc?.processingStatus
  // Records created before this field existed are equivalent to the migration backfill value.
  if (status === undefined || status === null) return 'new'
  if (isFormSubmissionStatus(status)) return status
  throw new FormSubmissionStatusError(
    'FORM_SUBMISSION_STATUS_INVALID',
    '表单提交处理状态无效',
  )
}

function getFormId(form: FormSubmission['form']): number {
  return typeof form === 'number' ? form : form.id
}

function protectImmutableSubmissionFacts(
  data: Partial<FormSubmission>,
  originalDoc: FormSubmission,
): void {
  if (data.form !== undefined) {
    if (getFormId(data.form) !== getFormId(originalDoc.form)) {
      throw new FormSubmissionStatusError(
        'FORM_SUBMISSION_FACT_IMMUTABLE',
        '表单提交关联的表单不可修改',
      )
    }
    delete data.form
  }

  if (data.submissionData !== undefined) {
    if (!isDeepStrictEqual(data.submissionData, originalDoc.submissionData)) {
      throw new FormSubmissionStatusError(
        'FORM_SUBMISSION_FACT_IMMUTABLE',
        '表单提交内容不可修改',
      )
    }
    delete data.submissionData
  }
}

/**
 * Protect the plugin-owned public create route and derive processing metadata on updates.
 *
 * Public submissions are always created as `new`. Update callers cannot set `processedAt`
 * or `processedBy`: those values come from the transition, original document and `req.user`.
 */
export const protectFormSubmissionStatus: CollectionBeforeChangeHook<FormSubmission> = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  if (operation === 'create') {
    data.processingStatus = 'new'
    data.processedAt = null
    data.processedBy = null
    return data
  }

  const permission = await derivePermissionContextFromRequest(req)
  if (
    !permission ||
    !hasMenuPermission(permission, 'form-submissions')
  ) {
    throw new FormSubmissionStatusError(
      'FORM_SUBMISSION_UPDATE_FORBIDDEN',
      '缺少表单提交更新权限',
    )
  }

  if (!originalDoc) {
    throw new FormSubmissionStatusError(
      'FORM_SUBMISSION_ORIGINAL_REQUIRED',
      '更新表单提交处理状态需要原始记录',
    )
  }

  protectImmutableSubmissionFacts(data, originalDoc)

  const currentStatus = getCurrentStatus(originalDoc)
  const requestedStatus = data.processingStatus
  const targetStatus =
    requestedStatus === undefined ? currentStatus : requestedStatus

  if (!isFormSubmissionStatus(targetStatus)) {
    throw new FormSubmissionStatusError(
      'FORM_SUBMISSION_STATUS_INVALID',
      '表单提交处理状态无效',
    )
  }

  if (!canTransitionFormSubmissionStatus(currentStatus, targetStatus)) {
    throw new FormSubmissionStatusError(
      'FORM_SUBMISSION_STATUS_TRANSITION_INVALID',
      `表单提交不允许从 ${currentStatus} 切换到 ${targetStatus}`,
    )
  }

  if (targetStatus === 'processed') {
    if (currentStatus === 'processed') {
      delete data.processedAt
      delete data.processedBy
      return data
    }

    const processorId = req.user?.id
    if (typeof processorId !== 'number' && typeof processorId !== 'string') {
      throw new FormSubmissionStatusError(
        'FORM_SUBMISSION_PROCESSOR_REQUIRED',
        '完成表单提交必须有当前登录用户',
      )
    }
    data.processedAt = new Date().toISOString()
    data.processedBy = processorId
    return data
  }

  data.processedAt = null
  data.processedBy = null
  return data
}
