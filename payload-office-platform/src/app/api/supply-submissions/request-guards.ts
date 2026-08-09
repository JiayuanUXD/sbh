import type { PoolLike } from '@/lib/rate-limit-pg'

type LocationLookup = Readonly<{
  find: (options: {
    collection: 'locations'
    where: { slug: { equals: string } }
    limit: 1
    depth: 0
    overrideAccess: true
  }) => Promise<{ docs: readonly Readonly<{ id?: number | string }>[] }>
}>

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const QUOTED_STRING = '"(?:[^"\\\\\r\n]|\\\\[\t -~])*"'
const JSON_MEDIA_TYPE = new RegExp(
  `^\\s*application\\/json\\s*(?:;\\s*${TOKEN}\\s*=\\s*(?:${TOKEN}|${QUOTED_STRING})\\s*)*$`,
  'i',
)

/** 仅接受精确 application/json 媒体类型及语法正确的参数。 */
export function isStrictJsonContentType(contentType: string | null): boolean {
  return contentType !== null && JSON_MEDIA_TYPE.test(contentType)
}

/** 从 Payload 数据库适配器中安全提取限流所需的最小 pg pool 接口。 */
export function extractPgPool(database: unknown): PoolLike | null {
  if (!isRecord(database) || !isPoolLike(database.pool)) return null
  return database.pool
}

/** 查询 MVP 默认城市；无匹配或查询异常都由调用方按 fail-closed 处理。 */
export async function resolveDefaultCityId(
  payload: LocationLookup,
  defaultCitySlug: string,
): Promise<number | null> {
  try {
    const result = await payload.find({
      collection: 'locations',
      where: { slug: { equals: defaultCitySlug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const cityId = result.docs[0]?.id
    return typeof cityId === 'number' ? cityId : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPoolLike(value: unknown): value is PoolLike {
  return isRecord(value) && typeof value.query === 'function'
}
