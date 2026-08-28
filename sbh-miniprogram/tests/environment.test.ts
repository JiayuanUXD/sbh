import { afterEach, describe, expect, it } from 'vitest'

import {
  assertApiBaseUrl,
  assertCloudResourceName,
  getCurrentRuntimeEnvironment,
  resolveRuntimeEnvironment,
  type MiniProgramEnvVersion,
} from '../miniprogram/config/environment.js'

const originalWxDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'wx')

afterEach(() => {
  if (originalWxDescriptor) {
    Object.defineProperty(globalThis, 'wx', originalWxDescriptor)
    return
  }

  Reflect.deleteProperty(globalThis, 'wx')
})

describe('运行环境选择', () => {
  it('将 develop 映射为本机 HTTP 运行环境', () => {
    expect(resolveRuntimeEnvironment('develop')).toEqual({
      stage: 'development',
      transport: 'http',
      apiBaseUrl: 'http://127.0.0.1:3717',
    })
  })

  it('将 release 映射为受控生产 CloudBase 目标', () => {
    expect(resolveRuntimeEnvironment('release')).toEqual({
      stage: 'production',
      transport: 'cloud-container',
      cloudEnvId: 'sbh-d9gnr8h5ef7e22e30',
      cloudServiceName: 'sbh',
    })
  })

  it('trial 未生成四字段 manifest 时 fail-closed', () => {
    expect(() => resolveRuntimeEnvironment('trial')).toThrow(/trial cloud env 未配置或非法/)
    Object.defineProperty(globalThis, 'wx', {
      configurable: true,
      value: { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) },
    })
    expect(() => getCurrentRuntimeEnvironment()).toThrow(/trial cloud env 未配置或非法/)
  })

  it('读取四字段 trial manifest 后返回 staging CloudBase 目标与部署身份', () => {
    const manifest = {
      cloudEnvId: 'sbhmini-d5g7d6732b2c64a66',
      cloudServiceName: 'sbhmini',
      gitCommitSha: 'a'.repeat(40),
      serverDeploymentRevision: 'sbhmini-016',
    }

    expect(resolveRuntimeEnvironment('trial', { trialManifest: manifest })).toEqual({
      stage: 'staging',
      transport: 'cloud-container',
      cloudEnvId: manifest.cloudEnvId,
      cloudServiceName: manifest.cloudServiceName,
      deploymentIdentity: {
        gitCommitSha: manifest.gitCommitSha,
        serverDeploymentRevision: manifest.serverDeploymentRevision,
      },
    })
  })

  const validTrialManifest = {
    cloudEnvId: 'sbhmini-d5g7d6732b2c64a66',
    cloudServiceName: 'sbhmini',
    gitCommitSha: 'a'.repeat(40),
    serverDeploymentRevision: 'sbhmini-016',
  }

  it.each([
    ['空 env', 'cloudEnvId', '', /trial cloud env 未配置或非法/],
    ['空白 env', 'cloudEnvId', ' sbhmini-d5g7d6732b2c64a66', /trial cloud env 未配置或非法/],
    ['带斜杠 env', 'cloudEnvId', 'sbhmini/staging', /trial cloud env 未配置或非法/],
    ['带点 env', 'cloudEnvId', 'sbhmini.staging', /trial cloud env 未配置或非法/],
    ['带协议 env', 'cloudEnvId', 'https://sbhmini', /trial cloud env 未配置或非法/],
    ['生产 env', 'cloudEnvId', 'sbh-d9gnr8h5ef7e22e30', /trial cloud env 与受控 staging 不一致/],
    ['大小写伪装 env', 'cloudEnvId', 'SBHMINI-D5G7D6732B2C64A66', /trial cloud env 未配置或非法/],
    ['空 service', 'cloudServiceName', '', /trial cloud service 未配置或非法/],
    ['空白 service', 'cloudServiceName', 'sbhmini ', /trial cloud service 未配置或非法/],
    ['带斜杠 service', 'cloudServiceName', 'sbh/mini', /trial cloud service 未配置或非法/],
    ['带点 service', 'cloudServiceName', 'sbh.mini', /trial cloud service 未配置或非法/],
    ['带协议 service', 'cloudServiceName', 'https://sbhmini', /trial cloud service 未配置或非法/],
    ['生产 service', 'cloudServiceName', 'sbh', /trial cloud service 与受控 staging 不一致/],
    ['大小写伪装 service', 'cloudServiceName', 'SBHMINI', /trial cloud service 未配置或非法/],
  ] as const)('trial 在选择 transport 前拒绝%s', (_label, field, value, error) => {
    expect(() => resolveRuntimeEnvironment('trial', {
      trialManifest: { ...validTrialManifest, [field]: value },
    })).toThrow(error)
  })

  it.each([
    ['git commit SHA', 'gitCommitSha', 'b'.repeat(39)],
    ['deployment revision', 'serverDeploymentRevision', 'bad/revision'],
  ] as const)('trial 在选择 transport 前拒绝非法%s', (_label, field, value) => {
    expect(() => resolveRuntimeEnvironment('trial', {
      trialManifest: { ...validTrialManifest, [field]: value },
    })).toThrow(/deployment identity 未配置或非法/)
  })

  it('对未知的小程序版本拒绝继续运行', () => {
    const resolveUnknownEnvironment = resolveRuntimeEnvironment as (envVersion: string) => unknown

    expect(() => resolveUnknownEnvironment('preview')).toThrow(/未知/)
  })

  it('从微信运行时读取环境版本后复用纯函数映射', () => {
    Object.defineProperty(globalThis, 'wx', {
      configurable: true,
      value: {
        getAccountInfoSync: () => ({
          miniProgram: { envVersion: 'develop' satisfies MiniProgramEnvVersion },
        }),
      },
    })

    expect(getCurrentRuntimeEnvironment()).toEqual({
      stage: 'development',
      transport: 'http',
      apiBaseUrl: 'http://127.0.0.1:3717',
    })
  })
})

describe('CloudBase 资源名校验', () => {
  it.each([
    'sbh',
    'sbhmini-d5g7d6732b2c64a66',
    `a${'0'.repeat(63)}`,
  ])('接受合法小写资源名：%s', (value) => {
    expect(assertCloudResourceName(value, 'cloud resource')).toBe(value)
  })

  it.each([
    '',
    ' ',
    ' sbhmini',
    'sbhmini ',
    'sbh/mini',
    'sbh.mini',
    'https://sbhmini',
    'SBHMINI',
    `a${'0'.repeat(64)}`,
  ])('拒绝非法资源名：%j', (value) => {
    expect(() => assertCloudResourceName(value, 'cloud resource')).toThrow('cloud resource 未配置或非法')
  })
})

describe('API 基址校验', () => {
  it('规范化根 origin 的尾部斜杠', () => {
    expect(assertApiBaseUrl('https://api.example.com/', false)).toBe('https://api.example.com')
  })

  it.each([
    'http://localhost:3717/',
    'http://127.0.0.1:3717/',
    'https://api.example.com/',
  ])('在开发环境接受 %s', (value) => {
    expect(assertApiBaseUrl(value, true)).toBe(value.slice(0, -1))
  })

  it('在开发环境拒绝非本机 HTTP 基址', () => {
    expect(() => assertApiBaseUrl('http://api.example.com', true)).toThrow(/HTTP/)
  })

  it.each([
    'http://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com?region=shanghai',
    'https://api.example.com#mini',
    'https://api.example.com/api/mini/v1',
    'https://localhost:3717',
    'https://127.0.0.1:3717',
  ])('在预发布和生产环境拒绝 %s', (value) => {
    expect(() => assertApiBaseUrl(value, false)).toThrow()
  })

  it.each([
    'https://[::1]',
    'https://[0:0:0:0:0:0:0:1]',
    'https://127.0.0.2',
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://017700000001',
    'https://127.0.1',
    'https://127.000.000.001',
  ])('在预发布和生产环境拒绝 IP 字面量 %s', (value) => {
    expect(() => assertApiBaseUrl(value, false)).toThrow(/HTTPS 域名/)
  })
})
