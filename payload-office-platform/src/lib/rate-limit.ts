// Minimal in-memory fixed-window rate limiter.
//
// Pure core: the store and clock are injected so it is trivially unit-testable
// and free of side effects. The HTTP layer owns the shared store and passes
// Date.now(). Note this is per-process — on CloudRun's multi-instance runtime
// each instance keeps its own window, so it is basic abuse mitigation, not a
// global quota. Good enough for MVP inquiry submits; revisit with a shared
// store (e.g. Redis) if strict global limits are ever required.

export type RateLimitStore = Map<string, { count: number; windowStart: number }>

export type RateLimitOptions = {
  windowMs: number
  max: number
}

export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
}

export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  now: number,
  { windowMs, max }: RateLimitOptions,
): RateLimitResult {
  const entry = store.get(key)

  // Start a fresh window if there is none or the current one has elapsed.
  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (entry.count < max) {
    entry.count += 1
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const remainingMs = windowMs - (now - entry.windowStart)
  return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
}
