import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTradingDays, replaySingleModeBacktest, replaySingleModeCandidates } from './market'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('market API contract', () => {
  it('uses the configured controller base and forwards abort signals', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, msg: '', data: [] }), { status: 200 }))

    await fetchTradingDays(controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(
      '/cw/backtest/trading-days',
      expect.objectContaining({
        cache: 'no-store',
        signal: controller.signal
      })
    )
  })

  it('surfaces backend and transport failures with actionable messages', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, msg: '回测参数错误', data: null })))
    await expect(fetchTradingDays()).rejects.toThrow('回测参数错误')

    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }))
    await expect(fetchTradingDays()).rejects.toThrow('HTTP 502')
  })

  it('calls the two distinct fixed-baseline replay endpoints', async () => {
    const run = { id: 10, tradeMode: 2, status: 1 }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: 0, msg: '', data: run })))

    await replaySingleModeBacktest(7)
    await replaySingleModeCandidates(7)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/cw/backtest/single-mode-runs/7/replays',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/cw/backtest/single-mode-runs/7/candidate-replays',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
