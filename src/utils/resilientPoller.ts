interface PollerOptions {
  interval?: number
  maxInterval?: number
  onError?: (error: unknown) => void
}

/**
 * Polls one async task, retries transient failures with bounded backoff, and
 * discards completions from a stopped or replaced polling generation.
 */
export class ResilientPoller {
  private readonly interval: number
  private readonly maxInterval: number
  private readonly onError?: (error: unknown) => void
  private timer?: ReturnType<typeof setTimeout>
  private generation = 0
  private failures = 0

  constructor(
    private readonly task: () => Promise<boolean>,
    options: PollerOptions = {}
  ) {
    this.interval = options.interval ?? 1_500
    this.maxInterval = options.maxInterval ?? 15_000
    this.onError = options.onError
  }

  start(): void {
    this.stop()
    this.failures = 0
    const generation = this.generation
    this.schedule(generation, this.interval)
  }

  stop(): void {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(generation: number, delay: number): void {
    if (generation !== this.generation) return
    this.timer = setTimeout(() => void this.poll(generation), delay)
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation) return
    try {
      const shouldContinue = await this.task()
      if (generation !== this.generation || !shouldContinue) return
      this.failures = 0
      this.schedule(generation, this.interval)
    } catch (error) {
      if (generation !== this.generation) return
      this.failures += 1
      this.onError?.(error)
      const retryDelay = Math.min(this.interval * 2 ** this.failures, this.maxInterval)
      this.schedule(generation, retryDelay)
    }
  }
}
