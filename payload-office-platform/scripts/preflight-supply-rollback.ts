/**
 * Guarded, read-only preflight for the generator-owned
 * 20260809_142444_supply_submissions_and_entrust_source down migration.
 *
 * This command never calls `payload migrate:down`. Payload's generated down
 * cannot safely express the new enum values and may drop dependencies twice,
 * so operators must first prove all eight incompatible data counts are zero and
 * then follow an explicitly reviewed controlled rollback.
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export type SupplyRollbackCounts = Readonly<{
  supplySubmissions: number
  entrustLeads: number
  supplyNotificationTypes: number
  supplyNotificationSources: number
  supplyDomainEventTypes: number
  supplyDomainAggregateTypes: number
  supplyJobTasks: number
  supplyJobLogTasks: number
}>

export type SupplyRollbackAssessment = Readonly<{
  safe: boolean
  blockers: string[]
  instructions: string[]
}>

export function buildSupplyRollbackAssessment(
  counts: SupplyRollbackCounts,
): SupplyRollbackAssessment {
  const blockers = [
    counts.supplySubmissions > 0 ? `supply_submissions rows: ${counts.supplySubmissions}` : null,
    counts.entrustLeads > 0 ? `leads.source_page_type=entrust rows: ${counts.entrustLeads}` : null,
    counts.supplyNotificationTypes > 0
      ? `notifications.type=supply-submission-created rows: ${counts.supplyNotificationTypes}`
      : null,
    counts.supplyNotificationSources > 0
      ? `notifications.source_type=supply-submission rows: ${counts.supplyNotificationSources}`
      : null,
    counts.supplyDomainEventTypes > 0
      ? `domain_events.event_type=supply-submission.created rows: ${counts.supplyDomainEventTypes}`
      : null,
    counts.supplyDomainAggregateTypes > 0
      ? `domain_events.aggregate_type=supply-submission rows: ${counts.supplyDomainAggregateTypes}`
      : null,
    counts.supplyJobTasks > 0
      ? `payload_jobs.task_slug=notify-supply-submission-created rows: ${counts.supplyJobTasks}`
      : null,
    counts.supplyJobLogTasks > 0
      ? `payload_jobs.log.taskSlug=notify-supply-submission-created rows: ${counts.supplyJobLogTasks}`
      : null,
  ].filter((item): item is string => item !== null)

  return {
    safe: blockers.length === 0,
    blockers,
    instructions: blockers.length
      ? [
          '禁止回滚：旧 schema 无法表示以上数据。不得删除历史来绕过检查。',
          '不要直接执行 payload migrate:down；先形成经批准的人工迁移清单。',
        ]
      : [
          '八项数据守卫均为零。不要直接执行 payload migrate:down。',
          '受控顺序：先回退通知唯一索引，再由 DBA 复核依赖并执行等价 schema 回滚。',
          '生成器 down 仍保持原文；其依赖重复删除限制未被修改或掩盖。',
        ],
  }
}

async function readCounts(): Promise<SupplyRollbackCounts> {
  process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
  const [{ getPayload }, { default: config }] = await Promise.all([
    import('payload'),
    import('../src/payload.config'),
  ])
  const payload = await getPayload({ config })
  try {
    const [
      supplySubmissions,
      entrustLeads,
      supplyNotificationTypes,
      supplyNotificationSources,
      supplyDomainEventTypes,
      supplyDomainAggregateTypes,
      supplyJobTasks,
      supplyJobLogTasks,
    ] =
      await Promise.all([
        payload.count({ collection: 'supply-submissions', overrideAccess: true }),
        payload.count({
          collection: 'leads',
          where: { sourcePageType: { equals: 'entrust' } },
          overrideAccess: true,
        }),
        payload.count({
          collection: 'notifications',
          where: { type: { equals: 'supply-submission-created' } },
          overrideAccess: true,
        }),
        payload.count({
          collection: 'notifications',
          where: { sourceType: { equals: 'supply-submission' } },
          overrideAccess: true,
        }),
        payload.count({
          collection: 'domain-events',
          where: { eventType: { equals: 'supply-submission.created' } },
          overrideAccess: true,
        }),
        payload.count({
          collection: 'domain-events',
          where: { aggregateType: { equals: 'supply-submission' } },
          overrideAccess: true,
        }),
        payload.count({
          collection: 'payload-jobs',
          where: { taskSlug: { equals: 'notify-supply-submission-created' } },
          overrideAccess: true,
        }),
        payload.count({
          collection: 'payload-jobs',
          where: { 'log.taskSlug': { equals: 'notify-supply-submission-created' } },
          overrideAccess: true,
        }),
      ])
    return {
      supplySubmissions: supplySubmissions.totalDocs,
      entrustLeads: entrustLeads.totalDocs,
      supplyNotificationTypes: supplyNotificationTypes.totalDocs,
      supplyNotificationSources: supplyNotificationSources.totalDocs,
      supplyDomainEventTypes: supplyDomainEventTypes.totalDocs,
      supplyDomainAggregateTypes: supplyDomainAggregateTypes.totalDocs,
      supplyJobTasks: supplyJobTasks.totalDocs,
      supplyJobLogTasks: supplyJobLogTasks.totalDocs,
    }
  } finally {
    await payload.db.destroy?.()
  }
}

async function main(): Promise<void> {
  const counts = await readCounts()
  const assessment = buildSupplyRollbackAssessment(counts)
  console.log('=== Supply schema rollback preflight (read-only) ===')
  console.log(JSON.stringify(counts, null, 2))
  for (const line of assessment.instructions) console.log(line)
  if (!assessment.safe) {
    for (const blocker of assessment.blockers) console.error(`[BLOCK] ${blocker}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`[rollback-preflight] ${message}`)
      process.exitCode = 1
    })
    .finally(() => process.exit(process.exitCode ?? 0))
}
