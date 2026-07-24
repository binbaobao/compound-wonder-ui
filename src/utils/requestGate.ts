export interface RequestToken {
  id: number
  signal: AbortSignal
}

/** Cancels superseded fetches and prevents stale responses from overwriting current state. */
export class RequestGate {
  private generation = 0
  private controller?: AbortController

  begin(): RequestToken {
    this.controller?.abort()
    this.controller = new AbortController()
    this.generation += 1
    return { id: this.generation, signal: this.controller.signal }
  }

  isCurrent(id: number): boolean {
    return id === this.generation && !this.controller?.signal.aborted
  }

  invalidate(): void {
    this.controller?.abort()
    this.controller = undefined
    this.generation += 1
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
