export type CosConfigEnv = Record<string, string | undefined>

export const MEDIA_COS_PREFIX = 'media'

const COS_ENV_KEYS = [
  'COS_BUCKET',
  'COS_REGION',
  'COS_ENDPOINT',
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
] as const

export type CosStorageConfig =
  | { enabled: false }
  | {
      enabled: true
      bucket: string
      region: string
      endpoint: string
      accessKeyId: string
      secretAccessKey: string
    }

function normalizedValue(env: CosConfigEnv, key: (typeof COS_ENV_KEYS)[number]): string {
  return env[key]?.trim() ?? ''
}

export function parseCosStorageConfig(env: CosConfigEnv): CosStorageConfig {
  const configuredKeys = COS_ENV_KEYS.filter((key) => normalizedValue(env, key) !== '')
  if (configuredKeys.length === 0) return { enabled: false }

  const missingKeys = COS_ENV_KEYS.filter((key) => normalizedValue(env, key) === '')
  if (missingKeys.length > 0) {
    throw new Error(`[cos] COS 配置不完整，缺少：${missingKeys.join(', ')}`)
  }

  const bucket = normalizedValue(env, 'COS_BUCKET')
  const region = normalizedValue(env, 'COS_REGION')
  const rawEndpoint = normalizedValue(env, 'COS_ENDPOINT')

  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]-\d{5,20}$/.test(bucket)) {
    throw new Error('[cos] COS_BUCKET 必须使用 bucket-name-APPID 格式')
  }
  if (!/^ap-[a-z0-9-]+$/.test(region)) {
    throw new Error('[cos] COS_REGION 必须是 ap-shanghai 等腾讯云地域标识')
  }

  let endpointUrl: URL
  try {
    endpointUrl = new URL(rawEndpoint)
  } catch {
    throw new Error('[cos] COS_ENDPOINT 不是合法 URL')
  }
  if (
    endpointUrl.protocol !== 'https:' ||
    endpointUrl.username !== '' ||
    endpointUrl.password !== '' ||
    (endpointUrl.pathname !== '' && endpointUrl.pathname !== '/') ||
    endpointUrl.search !== '' ||
    endpointUrl.hash !== ''
  ) {
    throw new Error('[cos] COS_ENDPOINT 必须是无路径、无凭据的 https 域名')
  }
  const expectedHostname = `cos.${region}.myqcloud.com`
  if (endpointUrl.hostname !== expectedHostname) {
    throw new Error(`[cos] COS_ENDPOINT 域名必须与 COS_REGION 匹配：${expectedHostname}`)
  }

  return {
    enabled: true,
    bucket,
    region,
    endpoint: endpointUrl.origin,
    accessKeyId: normalizedValue(env, 'COS_SECRET_ID'),
    secretAccessKey: normalizedValue(env, 'COS_SECRET_KEY'),
  }
}

export function collectCosProductionViolations(
  env: CosConfigEnv,
): Array<{ field: string; reason: string }> {
  if (env.NODE_ENV !== 'production') return []
  // CI e2e（GitHub Actions 恒设 CI=true）用 `next start` 跑生产 server，但媒体走
  // seed-media 离线 sharp 本地合成，并非 CloudRun 部署，COS 需求不适用——跳过以免
  // 守卫误拒启动。真实 CloudRun 不设 CI，仍强制 COS。
  if (env.CI) return []

  try {
    const config = parseCosStorageConfig(env)
    if (config.enabled) return []
    return [
      {
        field: 'COS_STORAGE',
        reason: '生产环境必须配置 COS，禁止将媒体写入 CloudRun 临时磁盘',
      },
    ]
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'COS 配置无效'
    return [{ field: 'COS_STORAGE', reason }]
  }
}
