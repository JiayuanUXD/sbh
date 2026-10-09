import type { RequestOptions } from './mini-api-contracts.js'

type SessionData = Readonly<{ anonymousContextToken: string; expiresAt: string }>
type RequestClient = (options: RequestOptions<unknown>) => Promise<unknown>

export interface SessionDependencies {
  login: () => Promise<Readonly<{ code: string }>>
  request: RequestClient
  now?: () => number
}

const TOKEN = /^[A-Za-z0-9._~-]{1,4096}$/
const SAFETY_WINDOW_MS = 30_000
const SESSION_KEYS = new Set(['anonymousContextToken', 'expiresAt'])

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'))
  })
}

function parseSessionData(value: unknown): SessionData {
  if (!isPlainDataRecord(value)) throw new Error('invalid session response')
  const keys = Object.keys(value)
  if (
    keys.length !== SESSION_KEYS.size
    || keys.some((key) => !SESSION_KEYS.has(key))
    || ![...SESSION_KEYS].every((key) => Object.hasOwn(value, key))
    || typeof value.anonymousContextToken !== 'string'
    || !TOKEN.test(value.anonymousContextToken)
    || typeof value.expiresAt !== 'string'
  ) {
    throw new Error('invalid session response')
  }
  return {
    anonymousContextToken: value.anonymousContextToken,
    expiresAt: value.expiresAt,
  }
}

function validSession(value: SessionData, readNow: () => number): boolean {
  const now = readNow()
  if (!Number.isSafeInteger(now) || now < 0) return false
  const expiresAt = Date.parse(value.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt > now + SAFETY_WINDOW_MS
}

export function createSessionService(dependencies: SessionDependencies) {
  const now = dependencies.now ?? Date.now
  let cached: SessionData | null = null
  let inflight: Readonly<{
    generation: number
    promise: Promise<string | null>
  }> | null = null
  let generation = 0

  const releaseInflight = (completedGeneration: number): void => {
    if (inflight?.generation === completedGeneration) inflight = null
  }

  const ensureAnonymousContext = (): Promise<string | null> => {
    if (cached && validSession(cached, now)) {
      return Promise.resolve(cached.anonymousContextToken)
    }
    cached = null
    if (inflight) return inflight.promise

    const startedGeneration = generation
    const task = Promise.resolve().then(async (): Promise<string | null> => {
      try {
        const loginResult = await dependencies.login()
        if (generation !== startedGeneration) return null
        if (
          !loginResult
          || typeof loginResult.code !== 'string'
          || loginResult.code.length < 1
          || loginResult.code.length > 128
        ) {
          return null
        }
        const data = parseSessionData(await dependencies.request({
          path: '/api/mini/v1/session',
          method: 'POST',
          data: { loginCode: loginResult.code },
          parse: parseSessionData,
        }))
        if (generation !== startedGeneration || !validSession(data, now)) return null
        cached = data
        return data.anonymousContextToken
      } catch {
        return null
      } finally {
        releaseInflight(startedGeneration)
      }
    })
    inflight = { generation: startedGeneration, promise: task }
    return task
  }

  const clear = (): void => {
    generation += 1
    cached = null
    inflight = null
  }

  const getToken = (): string | null => {
    if (!cached || !validSession(cached, now)) {
      cached = null
      return null
    }
    return cached.anonymousContextToken
  }

  return { ensureAnonymousContext, clear, getToken }
}
