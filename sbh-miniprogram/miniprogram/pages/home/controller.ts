import type { MiniHomeData } from '../../services/catalog-contracts.js'
import {
  beginHomeLoad,
  failHomeLoad,
  presentHome,
  succeedHomeLoad,
  type HomePageSnapshot,
} from './model.js'

export type HomeLoadControllerDependencies = Readonly<{
  getHome(): Promise<MiniHomeData>
  getSnapshot(): HomePageSnapshot
  setSnapshot(snapshot: HomePageSnapshot): void
  stopPullDownRefresh(): void
}>

export type HomeLoadController = Readonly<{
  load(refresh?: boolean): Promise<void>
  invalidate(): void
}>

export function createHomeLoadController(
  dependencies: HomeLoadControllerDependencies,
): HomeLoadController {
  let requestVersion = 0
  let pullDownRefreshPending = false

  return {
    async load(refresh = false) {
      const owner = requestVersion + 1
      requestVersion = owner
      if (refresh) pullDownRefreshPending = true
      dependencies.setSnapshot(beginHomeLoad(dependencies.getSnapshot(), refresh))

      try {
        const content = presentHome(await dependencies.getHome())
        if (owner !== requestVersion) return
        dependencies.setSnapshot(succeedHomeLoad(dependencies.getSnapshot(), content))
      } catch {
        if (owner !== requestVersion) return
        dependencies.setSnapshot(failHomeLoad(dependencies.getSnapshot()))
      } finally {
        if (owner === requestVersion && pullDownRefreshPending) {
          pullDownRefreshPending = false
          dependencies.stopPullDownRefresh()
        }
      }
    },

    invalidate() {
      requestVersion += 1
      pullDownRefreshPending = false
    },
  }
}
