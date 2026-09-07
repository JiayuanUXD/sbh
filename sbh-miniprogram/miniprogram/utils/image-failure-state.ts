export type ImageFailureState = Readonly<Record<string, boolean>>

/** 按稳定图片身份标记坏图，不让一张图的错误污染同列其他项。 */
export function markImageFailed(
  current: ImageFailureState,
  identity: string,
): ImageFailureState {
  if (!identity.trim()) return current
  if (current[identity] === true) return current
  return { ...current, [identity]: true }
}
