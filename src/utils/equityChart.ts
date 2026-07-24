import type { HistoricalBacktestDailyRecord } from '../types/market'

export interface EquityChartPoint {
  index: number
  id: number
  tradeDate: string
  cumulativeReturnRate: number
  dailyReturnRate: number
  totalAsset: number
  accountStatus: 0 | 1
  symbol?: string
  symbolName?: string
  x: number
  y: number
}

export interface EquityChartTick {
  value: number
  y: number
}

export interface EquityChartDateTick {
  label: string
  x: number
}

export interface EquityChartModel {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  min: number
  max: number
  zeroY: number
  points: EquityChartPoint[]
  linePath: string
  areaPath: string
  yTicks: EquityChartTick[]
  xTicks: EquityChartDateTick[]
}

export interface EquityChartRange {
  /** Inclusive record index. */
  start: number
  /** Exclusive record index. */
  end: number
}

export type EquityZoomDirection = 'in' | 'out'

const defaultDimensions = {
  width: 1_000,
  height: 360,
  left: 64,
  right: 24,
  top: 24,
  bottomPadding: 48
}

/**
 * Resizes a visible record range while keeping the focused record at the same
 * relative horizontal position whenever the data boundaries allow it.
 */
export function zoomEquityRange(
  current: EquityChartRange,
  totalCount: number,
  focusIndex: number,
  direction: EquityZoomDirection,
  minimumVisiblePoints = 8
): EquityChartRange {
  const total = Math.max(0, Math.floor(totalCount))
  if (!total) return { start: 0, end: 0 }

  const start = Math.min(total - 1, Math.max(0, Math.floor(current.start)))
  const end = Math.min(total, Math.max(start + 1, Math.ceil(current.end)))
  const currentLength = end - start
  const minimum = Math.min(total, Math.max(1, Math.floor(minimumVisiblePoints)))
  const targetLength =
    direction === 'in'
      ? Math.max(minimum, Math.min(currentLength, Math.floor(currentLength * 0.8)))
      : Math.min(total, Math.max(currentLength, Math.ceil(currentLength / 0.8)))

  if (targetLength === currentLength) return { start, end }

  const focus = Math.min(end - 1, Math.max(start, Math.round(focusIndex)))
  const focusRatio = currentLength === 1 ? 0.5 : (focus - start) / (currentLength - 1)
  const nextStart = Math.min(total - targetLength, Math.max(0, Math.round(focus - focusRatio * (targetLength - 1))))
  return { start: nextStart, end: nextStart + targetLength }
}

/** Moves a visible record range by whole trading days and clamps it to the available data. */
export function panEquityRange(current: EquityChartRange, totalCount: number, recordOffset: number): EquityChartRange {
  const total = Math.max(0, Math.floor(totalCount))
  if (!total) return { start: 0, end: 0 }

  const start = Math.min(total - 1, Math.max(0, Math.floor(current.start)))
  const end = Math.min(total, Math.max(start + 1, Math.ceil(current.end)))
  const length = end - start
  if (length >= total) return { start: 0, end: total }

  const offset = Number.isFinite(recordOffset) ? Math.round(recordOffset) : 0
  const nextStart = Math.min(total - length, Math.max(0, start + offset))
  return { start: nextStart, end: nextStart + length }
}

/** Converts daily backtest records into a responsive SVG curve model. */
export function buildEquityChartModel(
  records: HistoricalBacktestDailyRecord[],
  dimensions = defaultDimensions
): EquityChartModel | null {
  const validRecords = records
    .map((record, index) => ({ record, index, value: Number(record.cumulativeReturnRate) }))
    .filter((item) => Number.isFinite(item.value))
  if (!validRecords.length) return null

  const width = dimensions.width
  const height = dimensions.height
  const left = dimensions.left
  const right = width - dimensions.right
  const top = dimensions.top
  const bottom = height - dimensions.bottomPadding
  const values = validRecords.map((item) => item.value)
  const rawMin = Math.min(0, ...values)
  const rawMax = Math.max(0, ...values)
  const padding = Math.max((rawMax - rawMin) * 0.16, 0.01)
  const min = rawMin - padding
  const max = rawMax + padding
  const range = max - min || 1
  const plotWidth = right - left
  const plotHeight = bottom - top
  const toY = (value: number) => top + ((max - value) / range) * plotHeight

  const points = validRecords.map<EquityChartPoint>(({ record, index, value }, pointIndex) => ({
    index,
    id: record.id,
    tradeDate: record.tradeDate,
    cumulativeReturnRate: value,
    dailyReturnRate: Number(record.dailyReturnRate ?? 0),
    totalAsset: Number(record.totalAsset ?? 0),
    accountStatus: record.accountStatus,
    symbol: record.symbol,
    symbolName: record.symbolName,
    x: validRecords.length === 1 ? left + plotWidth / 2 : left + (pointIndex / (validRecords.length - 1)) * plotWidth,
    y: toY(value)
  }))
  const linePath = smoothPath(points)
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${bottom.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${bottom.toFixed(2)} Z`
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = max - (index / 4) * range
    return { value, y: toY(value) }
  })
  const xTickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
  const xTicks = xTickIndexes.map((index) => ({
    label: points[index].tradeDate,
    x: points[index].x
  }))

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    min,
    max,
    zeroY: toY(0),
    points,
    linePath,
    areaPath,
    yTicks,
    xTicks
  }
}

/** Returns the trading-day point closest to an SVG x coordinate. */
export function nearestEquityPointIndex(points: EquityChartPoint[], chartX: number) {
  if (!points.length) return null
  let left = 0
  let right = points.length - 1
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (points[middle].x < chartX) {
      left = middle + 1
    } else {
      right = middle
    }
  }
  if (left === 0) return 0
  const previous = left - 1
  return Math.abs(points[left].x - chartX) < Math.abs(points[previous].x - chartX) ? left : previous
}

function smoothPath(points: EquityChartPoint[]) {
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`

  return points.slice(0, -1).reduce(
    (path, point, index) => {
      const previous = points[index - 1] ?? point
      const next = points[index + 1]
      const afterNext = points[index + 2] ?? next
      const firstControlX = point.x + (next.x - previous.x) / 6
      const firstControlY = point.y + (next.y - previous.y) / 6
      const secondControlX = next.x - (afterNext.x - point.x) / 6
      const secondControlY = next.y - (afterNext.y - point.y) / 6
      return `${path} C ${firstControlX.toFixed(2)} ${firstControlY.toFixed(2)}, ${secondControlX.toFixed(2)} ${secondControlY.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
    },
    `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  )
}
