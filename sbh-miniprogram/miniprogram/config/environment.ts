export type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

export type RuntimeStage = 'development' | 'staging' | 'production'

export interface RuntimeEnvironment {
  stage: RuntimeStage
  apiBaseUrl: string
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1'])
const API_BASE_URL_PATTERN = /^(https?):\/\/([^/?#]+)\/?$/i
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i
const IPV6_AUTHORITY_PATTERN = /^\[([a-f0-9:.]+)\](?::([0-9]+))?$/i
const HOSTNAME_AUTHORITY_PATTERN = /^([^:]+?)(?::([0-9]+))?$/
const IPV4_LITERAL_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/

const ENVIRONMENTS: Record<MiniProgramEnvVersion, RuntimeEnvironment> = {
  develop: {
    stage: 'development',
    apiBaseUrl: 'http://127.0.0.1:3717',
  },
  trial: {
    stage: 'staging',
    // 当前只读阶段临时复用生产域名；MP-104 写接口前必须切换至独立预发布域名。
    apiBaseUrl: 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com',
  },
  release: {
    stage: 'production',
    apiBaseUrl: 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com',
  },
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
    (normalizedProtocol === 'https' && port === '443') ||
    (normalizedProtocol === 'http' && port === '80')
  )
    ? `:${port}`
    : ''
  const normalizedOrigin = `${normalizedProtocol}://${ipv6Match ? `[${normalizedHost}]` : normalizedHost}${normalizedPort}`
  const isLocalhost = LOCALHOST_NAMES.has(normalizedHost)
  const isIpLiteral = Boolean(ipv6Match) || IPV4_LITERAL_PATTERN.test(normalizedHost)

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

export function resolveRuntimeEnvironment(envVersion: MiniProgramEnvVersion): RuntimeEnvironment {
  const configuredEnvironment = ENVIRONMENTS[envVersion]

  if (!configuredEnvironment) {
    throw new Error(`未知的小程序环境版本：${String(envVersion)}`)
  }

  return {
    stage: configuredEnvironment.stage,
    apiBaseUrl: assertApiBaseUrl(
      configuredEnvironment.apiBaseUrl,
      configuredEnvironment.stage === 'development',
    ),
  }
}

export function getCurrentRuntimeEnvironment(): RuntimeEnvironment {
  return resolveRuntimeEnvironment(wx.getAccountInfoSync().miniProgram.envVersion)
}
