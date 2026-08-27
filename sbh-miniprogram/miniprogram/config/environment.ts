import { trialDeploymentManifest } from './trial-deployment.generated.js'

export type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

export type RuntimeStage = 'development' | 'staging' | 'production'

export interface RuntimeEnvironment {
  stage: RuntimeStage
  apiBaseUrl: string
  deploymentIdentity?: Readonly<{ gitCommitSha: string; serverDeploymentRevision: string }>
}

interface EnvironmentConfig {
  stage: RuntimeStage
  apiBaseUrl?: string
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1'])
const API_BASE_URL_PATTERN = /^(https?):\/\/([^/?#]+)\/?$/i
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i
const IPV6_AUTHORITY_PATTERN = /^\[([a-f0-9:.]+)\](?::([0-9]+))?$/i
const HOSTNAME_AUTHORITY_PATTERN = /^([^:]+?)(?::([0-9]+))?$/
const IPV4_LITERAL_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/
const NUMERIC_IP_PART_PATTERN = /^(?:0x[0-9a-f]+|0[0-7]*|[0-9]+)$/i

const RELEASE_API_BASE_URL = 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com'
const SHA = /^[0-9a-f]{40}$/
const REVISION = /^[A-Za-z0-9._-]{1,128}$/
const ENVIRONMENTS: Record<MiniProgramEnvVersion, EnvironmentConfig> = {
  develop: {
    stage: 'development',
    apiBaseUrl: 'http://127.0.0.1:3717',
  },
  trial: {
    stage: 'staging',
  },
  release: {
    stage: 'production',
    apiBaseUrl: RELEASE_API_BASE_URL,
  },
}

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

export function resolveRuntimeEnvironment(
  envVersion: MiniProgramEnvVersion,
  options: Readonly<{
    trialManifest?: Readonly<{ apiBaseUrl: string; gitCommitSha: string; serverDeploymentRevision: string }>
  }> = {},
): RuntimeEnvironment {
  const configuredEnvironment = ENVIRONMENTS[envVersion]

  if (!configuredEnvironment) {
    throw new Error(`未知的小程序环境版本：${String(envVersion)}`)
  }

  const manifest = options.trialManifest ?? trialDeploymentManifest
  const trialConfig = envVersion === 'trial'
    ? {
      apiBaseUrl: manifest.apiBaseUrl,
      gitCommitSha: manifest.gitCommitSha,
      serverDeploymentRevision: manifest.serverDeploymentRevision,
    }
    : null
  const apiBaseUrl = envVersion === 'trial'
    ? trialConfig?.apiBaseUrl
    : configuredEnvironment.apiBaseUrl
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.length === 0) {
    throw new Error('独立预发布 API 未配置')
  }
  const normalizedApiBaseUrl = assertApiBaseUrl(apiBaseUrl, configuredEnvironment.stage === 'development')
  const normalizedReleaseApiBaseUrl = assertApiBaseUrl(RELEASE_API_BASE_URL, false)
  if (envVersion === 'trial' && normalizedApiBaseUrl === normalizedReleaseApiBaseUrl) {
    throw new Error('独立预发布 API 不能复用生产 API')
  }
  if (envVersion === 'trial' && (!trialConfig || !SHA.test(trialConfig.gitCommitSha) || !REVISION.test(trialConfig.serverDeploymentRevision))) {
    throw new Error('trial deployment identity 未配置或非法')
  }
  return {
    stage: configuredEnvironment.stage,
    apiBaseUrl: normalizedApiBaseUrl,
    ...(envVersion === 'trial' && trialConfig ? { deploymentIdentity: { gitCommitSha: trialConfig.gitCommitSha, serverDeploymentRevision: trialConfig.serverDeploymentRevision } } : {}),
  }
}

export function getCurrentRuntimeEnvironment(): RuntimeEnvironment {
  return resolveRuntimeEnvironment(wx.getAccountInfoSync().miniProgram.envVersion)
}
