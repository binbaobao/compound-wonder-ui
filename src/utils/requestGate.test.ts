import { describe, expect, it } from 'vitest'
import { RequestGate } from './requestGate'

describe('RequestGate', () => {
  it('aborts the previous request and only accepts the latest generation', () => {
    const gate = new RequestGate()
    const first = gate.begin()
    const second = gate.begin()

    expect(first.signal.aborted).toBe(true)
    expect(gate.isCurrent(first.id)).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(gate.isCurrent(second.id)).toBe(true)
  })

  it('invalidates the active request on demand', () => {
    const gate = new RequestGate()
    const active = gate.begin()

    gate.invalidate()

    expect(active.signal.aborted).toBe(true)
    expect(gate.isCurrent(active.id)).toBe(false)
  })
})
