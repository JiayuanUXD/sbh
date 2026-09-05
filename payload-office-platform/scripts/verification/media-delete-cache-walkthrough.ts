/**
 * 走查取证：删掉城市首页 hero 背景图之后，前台是否还在吐这条已删除的文件 URL。
 *
 * 与 `media-delete-cache-fixture.ts` 配套。协议（每跑一趟都要按顺序做全）：
 *
 *   1. `node --env-file-if-exists=.env.local --import tsx scripts/verification/media-delete-cache-fixture.ts`
 *      → 记下 mediaId 与文件名；
 *   2. **停 dev server → 删掉 `.next/dev/cache`（先 `find .next -name fetch-cache` 确认路径，
 *      它随 dev / prod 的 distDir 变化）→ 重启**。两步缺一不可：夹具脚本的写库不在请求上下文里，
 *      它自己触发的失效会被降级成一条 warn；而 `unstable_cache` 落盘在磁盘上，
 *      只重启不删缓存会让第 3 步读到旧 profile。
 *   3. 跑本脚本。
 *
 * ## 为什么中间要插一段「带外改库」
 *
 * 只验「删除后页面不再出现这条 URL」是**验不出东西的**：删除会把外键置空，
 * 缓存未命中同样会得到「页面上没有这条 URL」。第一版走查就栽在这里——
 * 对照组（把钩子摘掉）与实验组给出了完全相同的结果，整趟证据作废。
 *
 * 所以删除之前先做一次对照：在**请求上下文之外**把 `heroMedia` 改掉（脚本写库，
 * `revalidateTag` 拿不到上下文，等于没失效），再取一次页面。此时页面**必须还是旧值**
 * ——这才证明缓存真的握着这份数据、后面那一步才有意义。改完再原样改回去。
 *
 * 判据：
 *   - `cacheHeldDuringOutOfBandChange` 必须为 true，否则这趟走查无效，不许下结论；
 *   - `stillRenderedAfterDelete`：修复态必须 false，**对照态（把 `Media.hooks` 的两段钩子
 *     摘掉重跑一整趟）必须 true**。对照态也是 false 就说明对照无效，结论不成立。
 */

import { getPayload } from 'payload'

import config from '@/payload.config'

const BASE_URL = process.env.WALKTHROUGH_BASE_URL ?? 'http://localhost:3719'
const CITY_PATH = process.env.WALKTHROUGH_CITY_PATH ?? '/shanghai'
const EMAIL = process.env.WALKTHROUGH_EMAIL ?? 'e2e-adm@example.com'
// 本地夹具账号，seed.ts 里公开写着，不是真凭据；生产环境严禁走这条路径。
const PASSWORD = process.env.WALKTHROUGH_PASSWORD ?? 'Test1234!'

function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const hit = process.argv.find((arg) => arg.startsWith(prefix))
  if (!hit) throw new Error(`缺少参数 ${prefix}<值>`)
  return hit.slice(prefix.length)
}

async function cityHtmlContains(filename: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}${CITY_PATH}`, {
    headers: { Accept: 'text/html' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`${CITY_PATH} 返回 ${res.status}`)
  return (await res.text()).includes(filename)
}

async function main(): Promise<void> {
  const rawMediaId = requiredArg('media-id')
  const mediaId = Number(rawMediaId)
  const filename = requiredArg('filename')
  const profileId = Number(requiredArg('profile-id'))

  const payload = await getPayload({ config })

  const setHeroMedia = async (value: number | null): Promise<void> => {
    await payload.update({
      collection: 'city-site-profiles',
      id: profileId,
      data: { heroMedia: value },
      overrideAccess: true,
    })
  }

  // 1. 预热：确认前台真的把这张图渲染出来了。
  const renderedBeforeDelete = await cityHtmlContains(filename)
  if (!renderedBeforeDelete) {
    throw new Error(
      `前台没有渲染 ${filename}，这趟走查无效。请确认已按协议第 2 步删掉 fetch-cache 并重启 server。`,
    )
  }

  // 2. 缓存本底对照：带外改库（无请求上下文 → 失效不生效），页面必须仍是旧值。
  await setHeroMedia(null)
  const cacheHeldDuringOutOfBandChange = await cityHtmlContains(filename)
  await setHeroMedia(mediaId)

  // 3. 真正的被测操作：在请求上下文里删除这张图。
  const login = await fetch(`${BASE_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!login.ok) throw new Error(`登录失败：${login.status}`)
  const cookie = login.headers.get('set-cookie')
  if (!cookie) throw new Error('登录成功但没拿到 cookie')

  const deleted = await fetch(`${BASE_URL}/api/media/${mediaId}`, {
    method: 'DELETE',
    headers: { cookie },
  })

  const stillRenderedAfterDelete = await cityHtmlContains(filename)

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        cityPath: CITY_PATH,
        mediaId,
        profileId,
        filename,
        renderedBeforeDelete,
        cacheHeldDuringOutOfBandChange,
        deleteStatus: deleted.status,
        stillRenderedAfterDelete,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
