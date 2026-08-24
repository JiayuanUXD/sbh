/**
 * OPT-046 多进程复现：起一个只跑 Payload Jobs autoRun 的进程（不起 HTTP server）。
 *
 * 用法：
 *   PGAPPNAME=repro-1 node --env-file-if-exists=.env.local --import tsx scripts/repro-job-runner.ts
 *
 * `cron: true` 与生产容器走同一条路径（见 payload.config.ts 的 jobs.autoRun）。
 * PGAPPNAME 会落到 pg_stat_activity.application_name，用来定位是哪个进程在泄漏。
 */
import { getPayload } from 'payload'
import config from '@/payload.config'

async function main() {
  const name = process.env.PGAPPNAME ?? 'repro'
  await getPayload({ config, cron: true })
  console.log(`[${name}] job runner 已启动，autoRun 生效`)
  setInterval(() => {}, 1 << 30)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
