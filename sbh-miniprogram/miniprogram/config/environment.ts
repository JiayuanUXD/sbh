import { trialDeploymentManifest } from './trial-deployment.generated.js'

export type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

export type RuntimeStage = 'development' | 'staging' | 'production'

export type RuntimeEnvironment =
  | Readonly<{
      stage: 'development'
      transport: 'http'
      apiBaseUrl: string
    }>
  | Readonly<{
      stage: 'staging' | 'production'
      transport: 'cloud-container'
      cloudEnvId: string
      cloudServiceName: string
      deploymentIdentity?: Readonly<{
        gitCommitSha: string
        serverDeploymentRevision: string
      }>
    }>

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1'])
const API_BASE_URL_PATTERN = /^(https?):\/\/([^/?#]+)\/?$/i
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i
const IPV6_AUTHORITY_PATTERN = /^\[([a-f0-9:.]+)\](?::([0-9]+))?$/i
const HOSTNAME_AUTHORITY_PATTERN = /^([^:]+?)(?::([0-9]+))?$/
const IPV4_LITERAL_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/
const NUMERIC_IP_PART_PATTERN = /^(?:0x[0-9a-f]+|0[0-7]*|[0-9]+)$/i

const CLOUD_RESOURCE_NAME = /^[a-z][a-z0-9-]{0,63}$/
const PRODUCTION_ENV_ID = 'sbh-d9gnr8h5ef7e22e30'
const PRODUCTION_SERVICE_NAME = 'sbh'
const STAGING_ENV_ID = 'sbhmini-d5g7d6732b2c64a66'
const STAGING_SERVICE_NAME = 'sbhmini'
const SHA = /^[0-9a-f]{40}$/
const REVISION = /^[A-Za-z0-9._-]{1,128}$/

function isNumericIpLike(host: string): boolean {
  if (/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(host)) return true
  const parts = host.split('.')
  return parts.length > 1 && parts.every((part) => NUMERIC_IP_PART_PATTERN.test(part))
}

export function assertApiBaseUrl(value: string, allowLocalhost: boolean): string {
  const match = API_BASE_URL_PATTERN.exec(value)

  if (!match) {
    throw new Error('API 基址必须是有效的绝对 URL')
  }

  const [, protocol, authority] = match
  if (authority.includes('@')) {
    throw new Error('API 基址不能包含凭据')
  }

  const ipv6Match = IPV6_AUTHORITY_PATTERN.exec(authority)
  const hostnameMatch = HOSTNAME_AUTHORITY_PATTERN.exec(authority)
  const host = ipv6Match?.[1] ?? hostnameMatch?.[1]
  const port = ipv6Match?.[2] ?? hostnameMatch?.[2]

  if (!host || (!ipv6Match && !HOSTNAME_PATTERN.test(host)) || host.includes('..')) {
    throw new Error('API 基址必须包含合法主机名')
  }

  if (port && Number(port) > 65535) {
    throw new Error('API 基址端口无效')
  }

  const normalizedProtocol = protocol.toLowerCase()
  const normalizedHost = host.toLowerCase()
  const normalizedPort = port && !(
    (normalizedProtocol === 'https' && Number(port) === 443) ||
    (normalizedProtocol === 'http' && Number(port) === 80)
  )
    ? `:${port}`
    : ''
  const normalizedOrigin = `${normalizedProtocol}://${ipv6Match ? `[${normalizedHost}]` : normalizedHost}${normalizedPort}`
  const isLocalhost = LOCALHOST_NAMES.has(normalizedHost)
  const isIpLiteral = Boolean(ipv6Match) || normalizedHost.includes(':') || IPV4_LITERAL_PATTERN.test(normalizedHost) || isNumericIpLike(normalizedHost)

  if (allowLocalhost) {
    if (normalizedProtocol === 'https' || (normalizedProtocol === 'http' && isLocalhost)) {
      return normalizedOrigin
    }

    throw new Error('开发环境仅允许 HTTPS 或本机 HTTP API 基址')
  }

  if (normalizedProtocol !== 'https' || isLocalhost || isIpLiteral) {
    throw new Error('预发布和生产环境仅允许非本机 HTTPS 域名 API 基址')
  }

  return normalizedOrigin
}

export function assertCloudResourceName(value: string, label: string): string {
  if (value !== value.trim() || !CLOUD_RESOURCE_NAME.test(value)) {
    throw new Error(`${label} 未配置或非法`)
  }
  return value
}

export function resolveRuntimeEnvironment(
  envVersion: MiniProgramEnvVersion,
  options: Readonly<{
    trialManifest?: Readonly<{
      cloudEnvId: string
      cloudServiceName: string
      gitCommitSha: string
      serverDeploymentRevision: string
    }>
  }> = {},
): RuntimeEnvironment {
  if (envVersion === 'develop') {
    return {
      stage: 'development',
      transport: 'http',
      apiBaseUrl: assertApiBaseUrl('http://127.0.0.1:3717', true),
    }
  }

  if (envVersion === 'release') {
    return {
      stage: 'production',
      transport: 'cloud-container',
      cloudEnvId: assertCloudResourceName(PRODUCTION_ENV_ID, 'release cloud env'),
      cloudServiceName: assertCloudResourceName(PRODUCTION_SERVICE_NAME, 'release cloud service'),
    }
  }

  if (envVersion !== 'trial') {
    throw new Error(`未知的小程序环境版本：${String(envVersion)}`)
  }

  const manifest = options.trialManifest ?? trialDeploymentManifest
  const cloudEnvId = assertCloudResourceName(manifest.cloudEnvId, 'trial cloud env')
  const cloudServiceName = assertCloudResourceName(manifest.cloudServiceName, 'trial cloud service')
  if (cloudEnvId !== STAGING_ENV_ID) {
    throw new Error('trial cloud env 与受控 staging 不一致')
  }
  if (cloudServiceName !== STAGING_SERVICE_NAME) {
    throw new Error('trial cloud service 与受控 staging 不一致')
  }
  if (!SHA.test(manifest.gitCommitSha) || !REVISION.test(manifest.serverDeploymentRevision)) {
    throw new Error('trial deployment identity 未配置或非法')
  }

  return {
    stage: 'staging',
    transport: 'cloud-container',
    cloudEnvId,
    cloudServiceName,
    deploymentIdentity: {
      gitCommitSha: manifest.gitCommitSha,
      serverDeploymentRevision: manifest.serverDeploymentRevision,
    },
  }
}

export function getCurrentRuntimeEnvironment(): RuntimeEnvironment {
  return resolveRuntimeEnvironment(wx.getAccountInfoSync().miniProgram.envVersion)
}
