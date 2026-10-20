export interface Throttled<A extends unknown[]> {
  (...args: A): void
  /** Run any pending call immediately. */
  flush(): void
  /** Drop any pending call. */
  cancel(): void
}

/** Leading + trailing throttle: at most one call per `ms`, always delivering the latest args. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: A | null = null

  const run = () => {
    timer = undefined
    last = performance.now()
    const args = pending
    pending = null
    if (args) fn(...args)
  }

  const throttled = ((...args: A) => {
    pending = args
    if (timer !== undefined) return
    const wait = ms - (performance.now() - last)
    if (wait <= 0) run()
    else timer = setTimeout(run, wait)
  }) as Throttled<A>

  throttled.flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      run()
    }
  }
  throttled.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  return throttled
}
