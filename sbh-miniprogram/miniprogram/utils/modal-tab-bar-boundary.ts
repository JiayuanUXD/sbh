export type ModalTabBarState = 'visible' | 'hidden'

export type ModalTabBarBoundary = Readonly<{
  hide(): Promise<boolean>
  restore(): Promise<void>
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
  let revision = 0
  let queue: Promise<void> = Promise.resolve()

  const publish = (state: ModalTabBarState): void => {
    actual = state
    dependencies.onChange?.(state)
  }

  const request = (target: ModalTabBarState): Promise<boolean> => {
    desired = target
    revision += 1
    const owner = revision
    let result = false

    const operation = queue.then(async () => {
      if (actual === target) {
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
    return operation.then(() => result)
  }

  return {
    hide: () => request('hidden'),
    restore: async () => { await request('visible') },
    snapshot: () => ({ desired, actual }),
  }
}
