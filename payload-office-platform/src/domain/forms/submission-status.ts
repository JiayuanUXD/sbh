import type { CollectionBeforeChangeHook, CollectionConfig, Field } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasMenuPermission } from '@/domain/auth/permission-context'

export const FORM_SUBMISSION_STATUSES = ['new', 'processing', 'processed'] as const

export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number]

export const FORM_SUBMISSION_DEFAULT_COLUMNS = [
  'form',
  'processingStatus',
  'createdAt',
  'processedBy',
] as const

export function appendFormSubmissionStatusFields({
  defaultFields,
}: {
  defaultFields: Field[]
}): Field[] {
  return [
    ...defaultFields,
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
  const permission = await getPermissionContext(req as RequestContext)
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

  constructor(
    code: FormSubmissionStatusError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'FormSubmissionStatusError'
    this.code = code
  }
}

function getCurrentStatus(originalDoc: Record<string, unknown> | undefined): FormSubmissionStatus {
  const status = originalDoc?.processingStatus
  // Records created before this field existed are equivalent to the migration backfill value.
  if (status === undefined || status === null) return 'new'
  if (isFormSubmissionStatus(status)) return status
  throw new FormSubmissionStatusError(
    'FORM_SUBMISSION_STATUS_INVALID',
    '表单提交处理状态无效',
  )
}

/**
 * Protect the plugin-owned public create route and derive processing metadata on updates.
 *
 * Public submissions are always created as `new`. Update callers cannot set `processedAt`
 * or `processedBy`: those values come from the transition, original document and `req.user`.
 */
export const protectFormSubmissionStatus: CollectionBeforeChangeHook = async ({
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

  if (!originalDoc) {
    throw new FormSubmissionStatusError(
      'FORM_SUBMISSION_ORIGINAL_REQUIRED',
      '更新表单提交处理状态需要原始记录',
    )
  }

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
