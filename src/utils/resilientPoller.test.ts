import { describe, expect, it, vi } from 'vitest'
import { ResilientPoller } from './resilientPoller'

describe('ResilientPoller', () => {
  it('retries a transient error and stops after the task reports completion', async () => {
    vi.useFakeTimers()
    const task = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(false)
    const onError = vi.fn()
    const poller = new ResilientPoller(task, { interval: 100, maxInterval: 400, onError })

    poller.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(task).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(task).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(800)
    expect(task).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('ignores a stale task result after stop', async () => {
    vi.useFakeTimers()
    let resolveTask: ((value: boolean) => void) | undefined
    const task = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveTask = resolve
        })
    )
    const poller = new ResilientPoller(task, { interval: 100 })

    poller.start()
    await vi.advanceTimersByTimeAsync(100)
    poller.stop()
    resolveTask?.(true)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(task).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
