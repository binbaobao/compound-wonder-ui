<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MinuteTick, TradeEvent, TradeSide } from '../types/market'

type PhaseType = 'auction' | 'continuous' | 'break'

interface TradingPhase {
  key: string
  label: string
  start: string
  end: string
  type: PhaseType
  visualLength?: number
}

interface PlotPoint {
  key: string
  index: number
  x: number
  y: number
  price: number
  tick: MinuteTick
}

interface BsMarker {
  side: TradeSide
  time: string
  price: number
  x: number
  y: number
  label: string
  reason: string
}

const props = defineProps<{
  title: string
  legend: string
  ticks: MinuteTick[]
  events?: TradeEvent[]
  previousClose: number
  stockCode: string
  tradeDate: string
  isSt?: boolean
  floatShares?: number
  height?: number
  emptyText?: string
}>()

const height = computed(() => props.height ?? 430)
const hoverX = ref<number | null>(null)
const lockedIndex = ref<number | null>(null)
const chartMain = ref<HTMLElement | null>(null)
const svgWidth = ref(1000)
let resizeObserver: ResizeObserver | null = null
const padding = { top: 24, right: 54, bottom: 42, left: 52 }
const volumeHeight = 58
const priceBottomGap = 16

// A 股分时横轴按交易阶段压缩，午休和 09:25-09:30 不占可视宽度。
const phases: TradingPhase[] = [
  { key: 'open-auction', label: '开盘竞价', start: '09:15', end: '09:25', type: 'auction', visualLength: 1200 },
  { key: 'morning', label: '连续竞价', start: '09:30', end: '11:30', type: 'continuous' },
  { key: 'afternoon', label: '连续竞价', start: '13:00', end: '14:57', type: 'continuous' },
  { key: 'close-auction', label: '收盘竞价', start: '14:57', end: '15:00', type: 'auction', visualLength: 700 }
]

const timeGridSeconds = [
  '09:20',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00'
].map(toSecond)

const plotWidth = computed(() => svgWidth.value - padding.left - padding.right)
const plotTop = padding.top
const plotBottom = computed(() => height.value - padding.bottom - volumeHeight - priceBottomGap)
const plotHeight = computed(() => plotBottom.value - plotTop)
const volumeTop = computed(() => plotBottom.value + priceBottomGap)
const volumeBottom = computed(() => height.value - padding.bottom)
const auctionVolumeHeight = computed(() => Math.max(1, (volumeBottom.value - volumeTop.value) * 6 / 7 - 2))

function toSecond(time: string) {
  const [hour, minute, second = 0] = time.split(':').map(Number)
  return (hour * 60 + minute) * 60 + second
}

function tickSecond(tick: MinuteTick) {
  return toSecond(tick.tickTime)
}

function timeLabel(secondOfDay: number) {
  const minuteOfDay = Math.floor(secondOfDay / 60)
  const hourText = `${Math.floor(minuteOfDay / 60)}`.padStart(2, '0')
  const minuteText = `${minuteOfDay % 60}`.padStart(2, '0')
  return `${hourText}:${minuteText}`
}

const sessionRanges = computed(() => {
  let cursor = 0
  return phases.map(phase => {
    const startSecond = toSecond(phase.start)
    const endSecond = toSecond(phase.end)
    const length = endSecond - startSecond
    const visualLength = phase.visualLength ?? length
    const range = {
      ...phase,
      startSecond,
      endSecond,
      length,
      visualLength,
      startIndex: cursor,
      endIndex: cursor + visualLength
    }
    cursor += visualLength
    return range
  })
})

const totalSeconds = computed(() => {
  const ranges = sessionRanges.value
  return ranges[ranges.length - 1]?.endIndex ?? 1
})

function secondIndex(secondOfDay: number) {
  const range = sessionRanges.value.find(item => secondOfDay >= item.startSecond && secondOfDay <= item.endSecond)
  if (!range) return null
  const offset = Math.min(secondOfDay - range.startSecond, range.length)
  return range.startIndex + offset / range.length * range.visualLength
}

function xForSecond(secondOfDay: number) {
  const index = secondIndex(secondOfDay)
  if (index == null) return null
  return padding.left + index / totalSeconds.value * plotWidth.value
}

const validTicks = computed(() => (
  props.ticks
    .filter(tick => Number.isFinite(tick.price) && tick.price > 0 && secondIndex(tickSecond(tick)) != null)
    .sort((left, right) => left.timestamp - right.timestamp)
))

// 分时图按 A 股涨跌停价固定 y 轴，避免不同日期切换时被 tick 波动误导。
const yScale = computed(() => {
  const base = props.previousClose > 0 ? props.previousClose : validTicks.value[0]?.price ?? 0
  const limitRate = priceLimitRate.value
  const upper = base > 0 ? roundPrice(base * (1 + limitRate)) : 0.01
  const lower = base > 0 ? roundPrice(base * (1 - limitRate)) : 0
  return { base, upper, lower }
})

const priceLimitRate = computed(() => {
  const code = props.stockCode.trim()
  const prefix = code.slice(0, 2)
  if (prefix === '30' || prefix === '68') return 0.2
  if ((prefix === '00' || prefix === '60') && props.isSt && props.tradeDate < '2026-07-06') return 0.05
  return 0.1
})

function roundPrice(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function yForPrice(price: number) {
  const { upper, lower } = yScale.value
  if (upper === lower) return plotTop + plotHeight.value / 2
  const y = plotTop + (upper - price) / (upper - lower) * plotHeight.value
  return Math.min(plotBottom.value, Math.max(plotTop, y))
}

const points = computed<PlotPoint[]>(() => validTicks.value.map((tick, index) => {
  const second = tickSecond(tick)
  return {
    key: `${tick.timestamp}-${tick.tickTime}`,
    index,
    x: xForSecond(second) ?? padding.left,
    y: yForPrice(tick.price),
    price: tick.price,
    tick
  }
}))

const activePoint = computed(() => {
  if (lockedIndex.value != null && points.value[lockedIndex.value]) {
    return points.value[lockedIndex.value]
  }
  if (hoverX.value == null || !points.value.length) return null
  const index = nearestPointIndex(hoverX.value)
  return index == null ? null : points.value[index]
})

const isSnapshotLocked = computed(() => lockedIndex.value != null)
const activeTickVolume = computed(() => {
  const point = activePoint.value
  if (!point) return 0
  return volumeValues.value[point.index] ?? 0
})
const isActiveAuction = computed(() => {
  const point = activePoint.value
  return point ? isAuctionSecond(tickSecond(point.tick)) : false
})

const linePath = computed(() => {
  if (!points.value.length) return ''
  return points.value.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
})

const areaPath = computed(() => {
  if (!points.value.length) return ''
  const first = points.value[0]
  const last = points.value[points.value.length - 1]
  return `${linePath.value} L ${last.x.toFixed(2)} ${plotBottom.value.toFixed(2)} L ${first.x.toFixed(2)} ${plotBottom.value.toFixed(2)} Z`
})

const baseY = computed(() => yForPrice(yScale.value.base))

const gridLines = computed(() => {
  const { base, upper, lower } = yScale.value
  return [upper, (upper + base) / 2, base, (base + lower) / 2, lower].map(price => ({
    price,
    y: yForPrice(price),
    rate: base ? (price - base) / base * 100 : 0
  }))
})

const phaseRects = computed(() => sessionRanges.value.map(phase => {
  const startX = xForSecond(phase.startSecond) ?? padding.left
  const endX = xForSecond(phase.endSecond) ?? padding.left
  return {
    ...phase,
    x: startX,
    width: Math.max(1, endX - startX)
  }
}))

const timeGridLines = computed(() => timeGridSeconds.map(second => {
  const minute = Math.floor(second / 60) % 60
  return {
    key: second,
    x: xForSecond(second) ?? padding.left,
    weight: second === toSecond('11:30') ? 'major-break' : minute === 0 ? 'hour' : 'half-hour'
  }
}))

const volumeValues = computed(() => validTicks.value.map((tick, index) => tickVolumeValue(tick, validTicks.value[index - 1])))
const averagePricePoints = computed(() => validTicks.value.map(tick => {
  const averagePrice = cumulativeAveragePrice(tick)
  if (averagePrice == null) return null
  const second = tickSecond(tick)
  return {
    key: `${tick.timestamp}-average`,
    x: xForSecond(second) ?? padding.left,
    y: yForPrice(averagePrice),
    price: averagePrice
  }
}).filter(item => item != null))
const averagePricePath = computed(() => {
  if (!averagePricePoints.value.length) return ''
  return averagePricePoints.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
})
const volumeMax = computed(() => Math.max(1, ...validTicks.value.map((tick, index) => (
  isContinuousSecond(tickSecond(tick)) ? volumeValues.value[index] ?? 0 : 0
))))
const auctionVolumeMax = computed(() => Math.max(1, ...validTicks.value
  .filter(tick => isAuctionSecond(tickSecond(tick)))
  .flatMap(tick => [auctionMatchVolume(tick), auctionUnmatchedVolume(tick)])))
const volumeBars = computed(() => validTicks.value.map((tick, index) => {
  const second = tickSecond(tick)
  if (!isContinuousSecond(second)) return null
  const x = xForSecond(second) ?? padding.left
  const volume = volumeValues.value[index] ?? 0
  const barHeight = volume / volumeMax.value * (volumeBottom.value - volumeTop.value)
  const previous = validTicks.value[index - 1]
  return {
    key: `${tick.timestamp}-${volume}`,
    x,
    y: volumeBottom.value - barHeight,
    height: Math.max(1, barHeight),
    color: !previous || tick.price >= previous.price ? '#d92d20' : '#039855'
  }
}).filter(item => item != null))

const auctionVolumeBars = computed(() => validTicks.value.map((tick, index) => {
  const second = tickSecond(tick)
  if (!isAuctionSecond(second)) return null
  const buyVolume = auctionBuyVolume(tick)
  const sellVolume = auctionSellVolume(tick)
  const matchedVolume = Math.min(buyVolume, sellVolume)
  const unmatchedVolume = Math.abs(buyVolume - sellVolume)
  const matchedHeight = matchedVolume / auctionVolumeMax.value * auctionVolumeHeight.value
  const unmatchedHeight = unmatchedVolume / auctionVolumeMax.value * auctionVolumeHeight.value
  const color = buyVolume >= sellVolume ? '#d92d20' : '#039855'
  return {
    key: `${tick.timestamp}-auction`,
    x: xForSecond(second) ?? padding.left,
    unmatchedY2: volumeTop.value + Math.max(1, unmatchedHeight),
    matchedY2: volumeBottom.value - Math.max(1, matchedHeight),
    color
  }
}).filter(item => item != null))

const backtestBsMarkers = computed<BsMarker[]>(() => {
  if (!props.events?.length) return []
  return props.events
    .map((event, index) => {
      const second = eventSecond(event.time)
      const x = second == null ? null : xForSecond(second)
      if (x == null || !Number.isFinite(event.price) || event.price <= 0) return null
      return {
        side: event.side,
        time: event.time,
        price: event.price,
        x,
        y: yForPrice(event.price) + index % 3 * 5,
        label: markerLabel(event.side),
        reason: event.reason
      }
    })
    .filter(item => item != null)
})

function formatPrice(value: number) {
  return value.toFixed(2)
}

function formatRate(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function eventSecond(time: string) {
  if (!time) return null
  const [hourText = '0', minuteText = '0', secondText = '0'] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (![hour, minute, second].every(Number.isFinite)) return null
  return hour * 3600 + minute * 60 + second
}

function markerLabel(side: TradeSide) {
  if (side === 'B') return '买'
  if (side === 'S') return '卖'
  return '撤'
}

function rateClassValue(value: number) {
  return value >= yScale.value.base ? 'rate-up' : 'rate-down'
}

function formatQuantity(value?: number) {
  const quantity = value ?? 0
  if (quantity >= 10000) return `${(quantity / 10000).toFixed(2)}万手`
  return `${quantity.toFixed(0)}手`
}

function formatTradeVolume(value?: number) {
  return formatQuantity((value ?? 0) / 100)
}

function formatPercent(value?: number) {
  return value == null ? '--' : `${value.toFixed(2)}%`
}

function isContinuousSecond(second: number) {
  return (second >= toSecond('09:30') && second <= toSecond('11:30'))
    || (second >= toSecond('13:00') && second < toSecond('14:57'))
}

function isAuctionSecond(second: number) {
  return (second >= toSecond('09:15') && second <= toSecond('09:25'))
    || (second >= toSecond('14:57') && second <= toSecond('15:00'))
}

function auctionBuyVolume(tick: MinuteTick) {
  return tick.buyerOrderId ?? 0
}

function auctionSellVolume(tick: MinuteTick) {
  return tick.sellerOrderId ?? 0
}

function auctionMatchVolume(tick: MinuteTick) {
  return Math.min(auctionBuyVolume(tick), auctionSellVolume(tick))
}

function auctionUnmatchedVolume(tick: MinuteTick) {
  return Math.abs(auctionBuyVolume(tick) - auctionSellVolume(tick))
}

function auctionUnmatchedColor(tick: MinuteTick) {
  return auctionBuyVolume(tick) >= auctionSellVolume(tick) ? '#d92d20' : '#039855'
}

function auctionAmount(tick: MinuteTick) {
  return tick.price * auctionMatchVolume(tick)
}

function tickVolumeValue(tick: MinuteTick, previous?: MinuteTick) {
  const quantity = tick.sellerOrderId ?? 0
  const second = tickSecond(tick)
  if (!isContinuousSecond(second)) return quantity
  if (!previous || !isContinuousSecond(tickSecond(previous))) return quantity
  return Math.max(0, quantity - (previous.sellerOrderId ?? 0))
}

function cumulativeAveragePrice(tick: MinuteTick) {
  if (!isContinuousSecond(tickSecond(tick))) return undefined
  const volume = tick.sellerOrderId ?? 0
  if (volume <= 0) return undefined
  return tickAmount(tick) / volume
}

function tickTurnoverRate(tick: MinuteTick) {
  const floatShares = props.floatShares ?? 0
  if (floatShares <= 0 || !isContinuousSecond(tickSecond(tick))) return undefined
  return (tick.sellerOrderId ?? 0) / floatShares * 100
}

function buyAmount(tick: MinuteTick) {
  return (tick.rawPrice ?? tick.price) * (tick.buyerOrderId ?? 0)
}

function isLimitUpBid(tick: MinuteTick) {
  const bidPrice = roundPrice(tick.rawPrice ?? tick.price)
  return bidPrice > 0 && bidPrice === yScale.value.upper
}

function isLimitUpMatch(tick: MinuteTick) {
  const matchPrice = roundPrice(tick.price)
  return matchPrice > 0 && matchPrice === yScale.value.upper
}

function limitUpTotalBuyRate(tick: MinuteTick) {
  const floatShares = props.floatShares ?? 0
  if (floatShares <= 0) return undefined
  return (tick.buyerOrderId ?? 0) / floatShares * 100
}

function limitUpTotalBuyAmount(tick: MinuteTick) {
  return tick.price * (tick.buyerOrderId ?? 0)
}

function tickAmount(tick: MinuteTick) {
  const amount = tick.amount ?? 0
  return tick.dataType === 401 ? amount * 100 : amount
}

function formatAmount(value?: number) {
  const amount = value ?? 0
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(2)}亿`
  if (amount >= 10000) return `${(amount / 10000).toFixed(2)}万`
  return `${amount.toFixed(0)}`
}

function nearestPointIndex(x: number) {
  const list = points.value
  if (!list.length) return null
  // tick 数量可能达到数千个，鼠标吸附用二分避免每次移动全量扫描。
  let left = 0
  let right = list.length - 1
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (list[middle].x < x) {
      left = middle + 1
    } else {
      right = middle
    }
  }
  if (left <= 0) return 0
  const previous = left - 1
  return Math.abs(list[left].x - x) < Math.abs(list[previous].x - x) ? left : previous
}

function pointerX(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  return (event.clientX - rect.left) / rect.width * svgWidth.value
}

function handlePointerMove(event: PointerEvent) {
  const x = pointerX(event)
  hoverX.value = Math.min(svgWidth.value - padding.right, Math.max(padding.left, x))
}

function clearHover() {
  if (isSnapshotLocked.value) return
  hoverX.value = null
}

function lockNearestSnapshot(event: PointerEvent) {
  const x = pointerX(event)
  const index = nearestPointIndex(x)
  if (index == null) return
  lockedIndex.value = index
  hoverX.value = points.value[index].x
  chartMain.value?.focus()
}

function moveLockedSnapshot(step: number) {
  if (!points.value.length) return
  const current = lockedIndex.value ?? (hoverX.value == null ? 0 : nearestPointIndex(hoverX.value) ?? 0)
  const next = Math.min(points.value.length - 1, Math.max(0, current + step))
  lockedIndex.value = next
  hoverX.value = points.value[next].x
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    moveLockedSnapshot(-1)
    event.preventDefault()
  } else if (event.key === 'ArrowRight') {
    moveLockedSnapshot(1)
    event.preventDefault()
  } else if (event.key === 'Escape') {
    lockedIndex.value = null
    hoverX.value = null
    event.preventDefault()
  }
}

function updateSvgWidth() {
  const element = chartMain.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  // 让 viewBox 比例跟随容器，避免 SVG 默认等比居中导致左右大留白。
  svgWidth.value = Math.max(1000, height.value * (rect.width / rect.height))
}

onMounted(() => {
  nextTick(updateSvgWidth)
  if (chartMain.value) {
    resizeObserver = new ResizeObserver(updateSvgWidth)
    resizeObserver.observe(chartMain.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <section class="chart-card minute-chart-card">
    <div class="chart-card-head minute-chart-head">
      <slot name="head">
        <strong>{{ title }}</strong>
        <small>{{ legend }}</small>
      </slot>
    </div>
    <div class="chart-wrap minute-chart-wrap has-snapshot" :style="{ height: `${height}px` }">
      <div
        ref="chartMain"
        class="chart-main minute-chart-main"
        tabindex="0"
        @keydown="handleKeydown"
      >
        <svg
          class="a-share-minute-svg"
          :viewBox="`0 0 ${svgWidth} ${height}`"
          role="img"
          aria-label="A 股分时图"
          @pointermove="handlePointerMove"
          @pointerdown="lockNearestSnapshot"
          @pointerleave="clearHover"
        >
          <defs>
            <linearGradient id="minuteAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2563eb" stop-opacity="0.18" />
              <stop offset="100%" stop-color="#2563eb" stop-opacity="0.02" />
            </linearGradient>
            <clipPath id="minutePriceClip">
              <rect
                :x="padding.left"
                :y="plotTop"
                :width="plotWidth"
                :height="plotBottom - plotTop"
              />
            </clipPath>
          </defs>

          <rect
            v-for="phase in phaseRects"
            :key="phase.key"
            :x="phase.x"
            :y="plotTop"
            :width="phase.width"
            :height="plotBottom - plotTop"
            :class="['minute-phase', phase.type]"
          />

          <line
            v-for="line in gridLines"
            :key="`${line.price}-${line.y}`"
            :x1="padding.left"
            :x2="svgWidth - padding.right"
            :y1="line.y"
            :y2="line.y"
            :class="{ baseline: Math.abs(line.price - yScale.base) < 0.0001 }"
            class="minute-grid-line"
          />

          <line
            v-for="line in timeGridLines"
            :key="`time-grid-${line.key}`"
            :x1="line.x"
            :x2="line.x"
            :y1="plotTop"
            :y2="volumeBottom"
            :class="['minute-time-line', line.weight]"
          />

          <g clip-path="url(#minutePriceClip)">
            <path v-if="areaPath" :d="areaPath" fill="url(#minuteAreaFill)" />
            <path v-if="linePath" :d="linePath" class="minute-price-line" />
            <path v-if="averagePricePath" :d="averagePricePath" class="minute-average-line" />
          </g>

          <g
            v-for="marker in backtestBsMarkers"
            :key="`${marker.side}-${marker.time}`"
            :class="['minute-bs-marker', marker.side.toLowerCase()]"
          >
            <circle :cx="marker.x" :cy="marker.y" r="5" />
          </g>

          <g v-if="activePoint" class="minute-crosshair" :class="{ locked: isSnapshotLocked }">
            <line
              :x1="activePoint.x"
              :x2="activePoint.x"
              :y1="plotTop"
              :y2="volumeBottom"
              class="minute-crosshair-line"
            />
            <line
              :x1="padding.left"
              :x2="svgWidth - padding.right"
              :y1="activePoint.y"
              :y2="activePoint.y"
              class="minute-crosshair-line"
            />
            <circle :cx="activePoint.x" :cy="activePoint.y" r="4" class="minute-crosshair-dot" />
            <rect
              :x="padding.left - 44"
              :y="activePoint.y - 12"
              width="40"
              height="22"
              rx="3"
              class="minute-axis-float"
            />
            <text
              :x="padding.left - 24"
              :y="activePoint.y + 4"
              class="minute-axis-float-text"
            >
              {{ formatPrice(activePoint.price) }}
            </text>
            <rect
              :x="svgWidth - padding.right + 2"
              :y="activePoint.y - 12"
              width="50"
              height="22"
              rx="3"
              class="minute-axis-float"
            />
            <text
              :x="svgWidth - padding.right + 27"
              :y="activePoint.y + 4"
              class="minute-axis-float-text"
            >
              {{ formatRate(yScale.base ? (activePoint.price - yScale.base) / yScale.base * 100 : 0) }}
            </text>
            <rect
              :x="Math.min(svgWidth - padding.right - 94, Math.max(padding.left + 4, activePoint.x - 45))"
              :y="volumeBottom + 8"
              width="90"
              height="22"
              rx="3"
              class="minute-axis-float"
            />
            <text
              :x="Math.min(svgWidth - padding.right - 49, Math.max(padding.left + 49, activePoint.x))"
              :y="volumeBottom + 24"
              class="minute-axis-float-text"
            >
              {{ activePoint.tick.tickTime }}
            </text>
          </g>

          <g class="minute-volume-bars">
            <template v-for="bar in auctionVolumeBars" :key="bar.key">
              <line
                :x1="bar.x"
                :x2="bar.x"
                :y1="volumeTop"
                :y2="bar.unmatchedY2"
                :stroke="bar.color"
                class="minute-auction-volume-bar"
              />
              <line
                :x1="bar.x"
                :x2="bar.x"
                :y1="volumeBottom"
                :y2="bar.matchedY2"
                :stroke="bar.color"
                class="minute-auction-volume-bar"
              />
            </template>
            <line
              v-for="bar in volumeBars"
              :key="bar.key"
              :x1="bar.x"
              :x2="bar.x"
              :y1="volumeBottom"
              :y2="bar.y"
              :stroke="bar.color"
              class="minute-continuous-volume-bar"
            />
          </g>

          <text
            v-for="line in gridLines"
            :key="`price-${line.price}`"
            :x="padding.left - 8"
            :y="line.y + 4"
            class="minute-axis-text left"
          >
            {{ formatPrice(line.price) }}
          </text>
          <text
            v-for="line in gridLines"
            :key="`rate-${line.price}`"
            :x="svgWidth - padding.right + 8"
            :y="line.y + 4"
            :class="['minute-axis-text', line.rate >= 0 ? 'rate-up' : 'rate-down']"
          >
            {{ formatRate(line.rate) }}
          </text>

        </svg>
        <div v-if="!ticks.length" class="chart-empty">{{ emptyText ?? '暂无分时数据' }}</div>
      </div>
      <aside class="minute-snapshot-side">
        <div v-if="activePoint" class="minute-snapshot-panel" :class="{ locked: isSnapshotLocked }">
          <div class="minute-snapshot-head">
            <strong>{{ activePoint.tick.tickTime }}</strong>
            <span>{{ isSnapshotLocked ? '已锁定' : 'Tick 快照' }}</span>
          </div>
          <div v-if="isActiveAuction" class="minute-snapshot-grid">
            <span>匹配价</span>
            <b>{{ activePoint.tick.price.toFixed(2) }}</b>
            <span>竞价涨幅</span>
            <b :class="rateClassValue(activePoint.price)">{{ formatRate(yScale.base ? (activePoint.price - yScale.base) / yScale.base * 100 : 0) }}</b>
            <span>竞价量</span>
            <b>{{ formatTradeVolume(auctionMatchVolume(activePoint.tick)) }}</b>
            <span>竞价金额</span>
            <b>{{ formatAmount(auctionAmount(activePoint.tick)) }}</b>
            <span>未匹配量</span>
            <b :style="{ color: auctionUnmatchedColor(activePoint.tick) }">{{ formatTradeVolume(auctionUnmatchedVolume(activePoint.tick)) }}</b>
            <template v-if="isLimitUpMatch(activePoint.tick)">
              <span>涨停买额</span>
              <b class="rate-up">{{ formatAmount(limitUpTotalBuyAmount(activePoint.tick)) }}</b>
              <span>涨停总买</span>
              <b class="rate-up">{{ formatPercent(limitUpTotalBuyRate(activePoint.tick)) }}</b>
            </template>
          </div>
          <div v-else class="minute-snapshot-grid">
            <span>现价</span>
            <b>{{ activePoint.tick.price.toFixed(2) }}</b>
            <span>均价</span>
            <b>{{ formatPrice(cumulativeAveragePrice(activePoint.tick) ?? activePoint.tick.price) }}</b>
            <span>成交量</span>
            <b>{{ formatTradeVolume(activePoint.tick.sellerOrderId) }}</b>
            <span>差量</span>
            <b>{{ formatTradeVolume(activeTickVolume) }}</b>
            <span>换手</span>
            <b>{{ formatPercent(tickTurnoverRate(activePoint.tick)) }}</b>
            <span>额</span>
            <b>{{ formatAmount(tickAmount(activePoint.tick)) }}</b>
            <span>{{ isLimitUpBid(activePoint.tick) ? '涨停买量' : '买一量' }}</span>
            <b>{{ formatTradeVolume(activePoint.tick.buyerOrderId) }}</b>
            <span>{{ isLimitUpBid(activePoint.tick) ? '涨停买额' : '买一额' }}</span>
            <b>{{ formatAmount(buyAmount(activePoint.tick)) }}</b>
          </div>
          <div class="minute-snapshot-hint">
            点击锁定，←/→ 逐 tick，Esc 取消
          </div>
        </div>
        <div v-else class="minute-snapshot-empty">
          <strong>Tick 快照</strong>
          <span>移动鼠标查看 3 秒快照</span>
        </div>
      </aside>
    </div>
  </section>
</template>
