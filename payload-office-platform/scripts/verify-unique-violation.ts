/**
 * 唯一约束冲突判定的真库验证（`pnpm verify:unique-violation`）
 *
 * 在**本地** PostgreSQL 上注入六张表的真实唯一约束冲突，用
 * `domain/shared/unique-violation.ts` 的正式实现判一遍，全部命中才退出 0。
 *
 * 与 `tests/unique-violation.test.ts` 的分工：单测跑的是 fixture，这里跑的是真库。
 * 之所以两边都要有——本次修复的起因正是「fixture 虚构了一个现实中不存在的错误形状」
 *（`{ code: '23505' }`），让六处兜底的测试常绿、真实路径却从来没被触发过。
 * Payload / drizzle 升级后错误形状若再变，跑这个脚本能立刻发现；只跑单测不会。
 *
 * 会写入并随后删除少量测试行，因此**拒绝对非环回数据库运行**（复用 seed 守卫的判据）。
 */
import { getPayload, createLocalReq } from 'payload'
import config from '@/payload.config'
import { isUniqueViolation } from '@/domain/shared/unique-violation'
import { CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY } from '@/domain/city-partner-application/application-protect'
import { detectProductionSeedTargets } from '@/lib/runtime/seed-target-guard'

const productionTargets = detectProductionSeedTargets({
  cosBucket: process.env.COS_BUCKET,
  databaseUrl: process.env.DATABASE_URL,
})
if (productionTargets.length > 0) {
  console.error(`拒绝运行：本脚本会写入测试行，检测到生产目标 —— ${productionTargets.join('、')}`)
  process.exit(1)
}

const TAG = `verify-uv-${Date.now()}`
const CITY = 1

type Row = { site: string; matched: boolean; ctor: string; entry: string }

async function main() {
  const payload = await getPayload({ config })
  const rows: Row[] = []
  const cleanups: Array<() => Promise<void>> = []

  const check = async (
    site: string,
    matcher: Parameters<typeof isUniqueViolation>[1],
    conflict: () => Promise<void>,
  ) => {
    try {
      await conflict()
      rows.push({ site, matched: false, ctor: '未抛异常', entry: '-' })
    } catch (e) {
      const entry = JSON.stringify((e as { data?: { errors?: unknown } })?.data?.errors ?? null)
      rows.push({
        site,
        matched: isUniqueViolation(e, matcher),
        ctor: (e as object)?.constructor?.name ?? typeof e,
        entry,
      })
    }
  }

  // supply_submissions
  {
    const base = {
      buildingName: '验证用楼盘', address: '验证用地址 1 号', areaSqm: 100,
      commissionMonths: 'none', contactPhone: '13800000201', status: 'pending',
      city: CITY, requestId: `${TAG}-sup`, idempotencyKey: `${TAG}-sup`,
      sourcePath: '/publish', sourceUrl: 'http://localhost:3717/publish',
      consentAccepted: true, consentPolicyVersion: 'v1', submitterIpHash: 'verify',
    }
    const first = await payload.create({ collection: 'supply-submissions', data: base as never, overrideAccess: true })
    cleanups.push(async () => { await payload.delete({ collection: 'supply-submissions', id: first.id, overrideAccess: true }).catch(() => {}) })
    await check(
      'supply-submissions/route.ts',
      { tableName: 'supply_submissions', column: 'idempotency_key', path: 'idempotencyKey' },
      async () => { await payload.create({ collection: 'supply-submissions', data: { ...base, requestId: `${TAG}-sup2` } as never, overrideAccess: true }) },
    )
  }

  // leads
  {
    const base = {
      name: '验证用姓名', phone: '13800000202', status: 'new', source: 'frontend-form',
      city: CITY, idempotencyKey: `${TAG}-lead`, sourcePageType: 'home', sourcePath: '/',
      sourceUrl: 'http://localhost:3717/', targetType: 'none',
      consentAccepted: true, consentPolicyVersion: 'v1',
    }
    const first = await payload.create({ collection: 'leads', data: base as never, overrideAccess: true })
    cleanups.push(async () => { await payload.delete({ collection: 'leads', id: first.id, overrideAccess: true }).catch(() => {}) })
    await check(
      'inquiries/route.ts',
      { tableName: 'leads', column: 'idempotency_key' },
      async () => { await payload.create({ collection: 'leads', data: base as never, overrideAccess: true }) },
    )
  }

  // information_corrections
  {
    const base = {
      targetType: 'building', targetSlug: 'verify-building', category: 'other',
      description: '验证用描述', status: 'new', requestId: `${TAG}-cor`,
      idempotencyKey: `${TAG}-cor`, reporterIpHash: 'verify',
    }
    const first = await payload.create({ collection: 'information-corrections', data: base as never, overrideAccess: true })
    cleanups.push(async () => { await payload.delete({ collection: 'information-corrections', id: first.id, overrideAccess: true }).catch(() => {}) })
    await check(
      'corrections/route.ts',
      { tableName: 'information_corrections', column: 'idempotency_key', path: 'idempotencyKey' },
      async () => { await payload.create({ collection: 'information-corrections', data: { ...base, requestId: `${TAG}-cor2` } as never, overrideAccess: true }) },
    )
  }

  // city_partner_applications
  {
    const base = {
      city: CITY, applicantName: '验证用申请人', contactPhone: '13800000203',
      applicantIdentity: 'other', otherIdentity: '验证', status: 'pending',
      requestId: `${TAG}-cpa`, idempotencyKey: `${TAG}-cpa`, sourcePath: '/join',
      sourceUrl: 'http://localhost:3717/join', consentAccepted: true,
      consentPolicyVersion: 'v1', submitterIpHash: 'verify',
    }
    const mkReq = () => createLocalReq({ context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-one' } } as never, payload)
    const first = await payload.create({ collection: 'city-partner-applications', data: base as never, overrideAccess: true, req: await mkReq() })
    cleanups.push(async () => { await payload.delete({ collection: 'city-partner-applications', id: first.id, overrideAccess: true }).catch(() => {}) })
    await check(
      'city-partner/public-service.ts',
      { tableName: 'city_partner_applications', column: 'idempotency_key', path: 'idempotencyKey' },
      async () => { await payload.create({ collection: 'city-partner-applications', data: { ...base, requestId: `${TAG}-cpa2` } as never, overrideAccess: true, req: await mkReq() }) },
    )
  }

  // notifications（复合唯一索引，两个通知消费器共用）
  {
    const base = {
      recipient: 2, type: 'supply-submission-created', title: '验证用通知', body: '验证',
      sourceType: 'supply-submission', sourceId: '999999', eventId: `${TAG}-event`,
    }
    const first = await payload.create({ collection: 'notifications', data: base as never, overrideAccess: true })
    cleanups.push(async () => { await payload.delete({ collection: 'notifications', id: first.id, overrideAccess: true }).catch(() => {}) })
    await check(
      'submission-notify.ts / application-notify.ts（notifications）',
      { tableName: 'notifications', column: 'event_id' },
      async () => { await payload.create({ collection: 'notifications', data: base as never, overrideAccess: true }) },
    )
  }

  // payload_jobs（局部表达式唯一索引）
  {
    const ev = `${TAG}-cpa-event`
    const queue = async () => {
      await payload.jobs.queue({
        task: 'notify-city-partner-application-created',
        queue: 'city-partner-application-notifications',
        input: { eventId: ev },
      } as never)
    }
    await queue()
    cleanups.push(async () => {
      const jobs = await payload.find({ collection: 'payload-jobs', where: { 'input.eventId': { equals: ev } }, limit: 10, overrideAccess: true }).catch(() => ({ docs: [] as Array<{ id: number | string }> }))
      for (const j of jobs.docs) await payload.delete({ collection: 'payload-jobs', id: j.id, overrideAccess: true }).catch(() => {})
    })
    await check('application-notify.ts（payload_jobs 入队）', { tableName: 'payload_jobs' }, queue)
  }

  for (const c of cleanups.reverse()) await c()
  const ev = await payload.find({ collection: 'domain-events', where: { eventId: { like: TAG } }, limit: 50, overrideAccess: true }).catch(() => ({ docs: [] as Array<{ id: number | string }> }))
  for (const e of ev.docs) await payload.delete({ collection: 'domain-events', id: e.id, overrideAccess: true }).catch(() => {})

  console.log('\n════ 真库判定结果（domain/shared/unique-violation.ts 正式实现）════')
  let allOk = true
  for (const r of rows) {
    if (!r.matched) allOk = false
    console.log(`${r.matched ? '✅' : '❌'} ${r.site.padEnd(52)} ctor=${r.ctor}`)
    console.log(`     errors=${r.entry}`)
  }
  console.log(allOk ? '\n全部命中。' : '\n有未命中项！')
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
