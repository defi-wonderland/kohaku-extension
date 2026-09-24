/**
 * The visibility rule of D-316: a hidden tab dispatches nothing to the
 * background until it is shown again, so a ceremony that hands off to a phone
 * reports its result when the tab returns.
 *
 * The gate takes the document as a parameter, so it runs under Jest's node
 * environment with a fabricated source and in the tab with `document`.
 */

/** The part of `document` the gate reads. */
export interface VisibilitySource {
  readonly visibilityState: string
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** Whether the source is shown: only `visible` counts, `hidden` and `prerender` hold. */
export const isVisible = (source: Pick<VisibilitySource, 'visibilityState'>): boolean =>
  source.visibilityState === 'visible'

export interface VisibilityGate {
  /**
   * Runs `dispatch` now where the source is visible, or holds it until the
   * source turns visible. Held dispatches run in the order they arrived.
   */
  dispatch<T>(dispatch: () => T | Promise<T>): Promise<T>
  /** How many dispatches wait for the tab to be shown. */
  pending(): number
  /** Drops the listener. Held dispatches never run and their promises reject. */
  dispose(): void
}

type Held = { run: () => void; drop: (reason: Error) => void }

/** A gate over `source` (D-316). */
export const createVisibilityGate = (source: VisibilitySource): VisibilityGate => {
  let held: Held[] = []
  let disposed = false

  const flush = () => {
    if (!isVisible(source)) return
    const ready = held
    held = []
    ready.forEach((h) => h.run())
  }

  const onChange = () => flush()
  source.addEventListener('visibilitychange', onChange)

  return {
    dispatch<T>(dispatch: () => T | Promise<T>): Promise<T> {
      if (disposed) return Promise.reject(new Error('The visibility gate is disposed.'))
      if (isVisible(source)) {
        try {
          return Promise.resolve(dispatch())
        } catch (error) {
          return Promise.reject(error)
        }
      }
      return new Promise<T>((resolve, reject) => {
        held.push({
          run: () => {
            try {
              Promise.resolve(dispatch()).then(resolve, reject)
            } catch (error) {
              reject(error)
            }
          },
          drop: reject
        })
      })
    },
    pending: () => held.length,
    dispose: () => {
      if (disposed) return
      disposed = true
      source.removeEventListener('visibilitychange', onChange)
      const dropped = held
      held = []
      dropped.forEach((h) => h.drop(new Error('The visibility gate was disposed first.')))
    }
  }
}

/** Resolves once `source` is visible, at once where it already is. */
export const whenVisible = (source: VisibilitySource): Promise<void> =>
  new Promise((resolve) => {
    if (isVisible(source)) {
      resolve()
      return
    }
    const onChange = () => {
      if (!isVisible(source)) return
      source.removeEventListener('visibilitychange', onChange)
      resolve()
    }
    source.addEventListener('visibilitychange', onChange)
  })
