import { afterEach, describe, expect, it } from 'vitest'

import {
  assertApiBaseUrl,
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
  it.each([
    ['develop', { stage: 'development', apiBaseUrl: 'http://127.0.0.1:3717' }],
    ['release', { stage: 'production', apiBaseUrl: 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com' }],
  ] as const)('将 %s 映射为预期的运行环境', (envVersion, expected) => {
    expect(resolveRuntimeEnvironment(envVersion)).toEqual(expected)
  })

  it('trial 未配置独立预发布 API 时 fail-closed，不返回生产 origin', () => {
    expect(() => resolveRuntimeEnvironment('trial')).toThrow(/独立预发布 API 未配置/)
    Object.defineProperty(globalThis, 'wx', {
      configurable: true,
      value: { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) },
    })
    expect(() => getCurrentRuntimeEnvironment()).toThrow(/独立预发布 API 未配置/)
  })

  it('trial 未来配置必须是经过基址校验的非本机 HTTPS origin', () => {
    const manifest = { apiBaseUrl: 'https://staging.example.com/', gitCommitSha: 'a'.repeat(40), serverDeploymentRevision: 'rev-1' }
    expect(resolveRuntimeEnvironment('trial', { trialManifest: manifest })).toEqual({
      stage: 'staging', apiBaseUrl: 'https://staging.example.com', deploymentIdentity: { gitCommitSha: 'a'.repeat(40), serverDeploymentRevision: 'rev-1' },
    })
    expect(() => resolveRuntimeEnvironment('trial', { trialManifest: { ...manifest, apiBaseUrl: 'http://staging.example.com' } })).toThrow(/HTTPS/)
  })

  it('读取完整 manifest seam 后返回 staging 与部署身份', () => {
    expect(resolveRuntimeEnvironment('trial', {
      trialManifest: {
        apiBaseUrl: 'https://staging.example.com',
        gitCommitSha: 'b'.repeat(40),
        serverDeploymentRevision: 'rev-manifest',
      },
    })).toEqual({
      stage: 'staging',
      apiBaseUrl: 'https://staging.example.com',
      deploymentIdentity: { gitCommitSha: 'b'.repeat(40), serverDeploymentRevision: 'rev-manifest' },
    })
  })

  it.each([
    'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com',
    'HTTPS://SBH-286300-10-1253925058.SH.RUN.TCLOUDBASE.COM:0443/',
  ])('trial 拒绝规范化后等同 release 的 API origin：%s', (apiBaseUrl) => {
    expect(() => resolveRuntimeEnvironment('trial', { trialManifest: { apiBaseUrl, gitCommitSha: 'a'.repeat(40), serverDeploymentRevision: 'rev-1' } })).toThrow(/独立预发布 API/)
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

    expect(getCurrentRuntimeEnvironment()).toEqual({ stage: 'development', apiBaseUrl: 'http://127.0.0.1:3717' })
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
