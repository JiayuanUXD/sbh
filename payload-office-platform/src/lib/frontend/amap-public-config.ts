const FALLBACK_AMAP_JS_KEY = '1d41019b28b9dc0c7b91b9f7f0927b75'

type AmapPublicEnv = Readonly<Record<string, string | undefined>>

export function getAmapJsKey(env: AmapPublicEnv = process.env): string {
  return env.NEXT_PUBLIC_AMAP_JS_KEY?.trim() || FALLBACK_AMAP_JS_KEY
}

export function hasAmapJsKey(env: AmapPublicEnv = process.env): boolean {
  return getAmapJsKey(env).length > 0
}
