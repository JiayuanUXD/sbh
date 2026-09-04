export type ModalTabBarState = 'visible' | 'hidden'

export type ModalTabBarBoundary = Readonly<{
  hide(): Promise<boolean>
  restore(): Promise<boolean>
  snapshot(): Readonly<{ desired: ModalTabBarState; actual: ModalTabBarState }>
}>

type Dependencies = Readonly<{
  hideTabBar(): Promise<void>
  showTabBar(): Promise<void>
  onChange?(state: ModalTabBarState): void
}>

export function createModalTabBarBoundary(dependencies: Dependencies): ModalTabBarBoundary {
  let desired: ModalTabBarState = 'visible'
  let actual: ModalTabBarState = 'visible'
  let actualTrusted = true
  let revision = 0
  let queue: Promise<void> = Promise.resolve()
  let pending: Readonly<{ target: ModalTabBarState; promise: Promise<boolean> }> | null = null

  const publish = (state: ModalTabBarState): void => {
    actual = state
    actualTrusted = true
    dependencies.onChange?.(state)
  }

  const request = (target: ModalTabBarState): Promise<boolean> => {
    if (pending?.target === target && desired === target) return pending.promise

    desired = target
    revision += 1
    const owner = revision
    let result = false

    const operation = queue.then(async () => {
      if (actual === target && actualTrusted) {
        result = owner === revision && desired === target
        return
      }

      try {
        if (target === 'hidden') await dependencies.hideTabBar()
        else await dependencies.showTabBar()
        publish(target)
        result = owner === revision && desired === target
      } catch {
        result = false
        actualTrusted = false
        if (target !== 'hidden') return

        try {
          await dependencies.showTabBar()
          publish('visible')
          if (owner === revision) desired = 'visible'
        } catch {
          // 两个原生调用都失败时保持上次已知状态，后续生命周期会再次 restore。
        }
      }
    })

    queue = operation.catch(() => undefined)
    const resultPromise = operation.then(() => result)
    const requestRecord = { target, promise: resultPromise }
    pending = requestRecord
    void resultPromise.finally(() => {
      if (pending === requestRecord) pending = null
    }).catch(() => undefined)
    return resultPromise
  }

  return {
    hide: () => request('hidden'),
    restore: () => request('visible'),
    snapshot: () => ({ desired, actual }),
  }
}
