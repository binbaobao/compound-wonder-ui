<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ActionType, CandleType, TooltipShowRule, dispose, init, registerLocale, registerOverlay } from 'klinecharts'
import type { LayoutChild } from 'klinecharts'
import type { ChartBar } from '../types/market'

const SELECTED_DATE_MARKER = 'selectedDateXAxisMarker'
let selectedDateMarkerRegistered = false

function registerSelectedDateMarker() {
  if (selectedDateMarkerRegistered) return
  // 用 KLineCharts 原生 overlay 绑定选中日期，避免外部 DOM 标记和缩放滚动错位。
  registerOverlay({
    name: SELECTED_DATE_MARKER,
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding }) => {
      const coordinate = coordinates[0]
      if (!coordinate) return []
      const y = bounding.top + 6
      return {
        type: 'polygon',
        attrs: {
          coordinates: [
            { x: coordinate.x, y: y + 10 },
            { x: coordinate.x - 6, y },
            { x: coordinate.x + 6, y }
          ]
        },
        styles: {
          style: 'fill',
          color: '#7c3aed'
        },
        ignoreEvent: true
      }
    }
  })
  selectedDateMarkerRegistered = true
}

registerLocale('zh-CN-custom', {
  time: '时间',
  open: '开',
  high: '高',
  low: '低',
  close: '收',
  volume: '成交量',
  change: '涨跌额',
  turnover: '成交额'
})

const props = defineProps<{
  title: string
  legend: string
  bars: ChartBar[]
  height?: number
  emptyText?: string
  showVolume?: boolean
  chartType?: 'candle' | 'area'
  markerTimestamp?: number
}>()

const chartId = `cw-chart-${Math.random().toString(36).slice(2)}`
const chart = shallowRef<any>(null)
const chartRoot = ref<HTMLElement | null>(null)
const container = ref<HTMLElement | null>(null)
const markerOverlayId = ref<string | null>(null)
const hoverDataIndex = ref<number | null>(null)
const lockedDataIndex = ref<number | null>(null)
const candlePaneOptions = {
  id: 'candle_pane',
  axisOptions: {
    // 日 K 的价格范围交给 KLineCharts 按高低点自动计算，禁止用户把 y 轴拖出画面。
    scrollZoomEnabled: false
  },
  gap: {
    top: 0.15,
    bottom: 0.08
  }
}

const candleLayout: LayoutChild[] = [
  {
    type: 'candle' as LayoutChild['type'],
    options: candlePaneOptions
  }
]

function applyData() {
  if (!chart.value) return
  if (props.showVolume) {
    chart.value.setPaneOptions(candlePaneOptions)
  }
  chart.value.applyNewData(props.bars)
  normalizeLockedDataIndex()
  updateSelectedDateMarker()
  updateNativeCrosshair()
}

function formatDateOnly(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeOnly(timestamp: number) {
  const date = new Date(timestamp)
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  const second = `${date.getSeconds()}`.padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function formatTurnover(value?: number) {
  const turnover = value ?? 0
  if (turnover >= 10000) return `${(turnover / 10000).toFixed(2)}亿`
  return `${turnover.toFixed(0)}万`
}

function formatPercent(value?: number) {
  return `${(value ?? 0).toFixed(2)}%`
}

function formatVolume(value?: number) {
  return `${((value ?? 0) / 1000000).toFixed(2)}万手`
}

function findSourceBar(current: ChartBar) {
  return props.bars.find((bar) => bar.timestamp === current.timestamp) ?? current
}

function createTooltip(current: ChartBar) {
  const source = findSourceBar(current)
  if (props.chartType === 'area') {
    return [
      { title: '', value: formatTimeOnly(source.timestamp) },
      { title: '价:', value: source.close.toFixed(2) }
    ]
  }
  return [
    { title: '', value: formatDateOnly(source.timestamp) },
    { title: '开:', value: source.open.toFixed(2) },
    { title: '高:', value: source.high.toFixed(2) },
    { title: '低:', value: source.low.toFixed(2) },
    { title: '收:', value: source.close.toFixed(2) },
    { title: '量:', value: formatVolume(source.volume) },
    { title: '额:', value: formatTurnover(source.turnover) },
    { title: '涨:', value: formatPercent(source.changeRate) },
    { title: '换:', value: formatPercent(source.turnoverRate) },
    { title: '振:', value: formatPercent(source.amplitude) },
    { title: '周期:', value: formatCycleReturn(source) }
  ]
}

function formatCycleReturn(current: ChartBar) {
  const source = findSourceBar(current)
  const currentIndex = props.bars.findIndex((bar) => bar.timestamp === source.timestamp)
  const lastIndex = props.bars.length - 1
  const lastBar = props.bars[lastIndex]
  if (currentIndex < 0 || !lastBar || !source.close) {
    return '(0|0.00%)'
  }
  const period = Math.max(0, lastIndex - currentIndex)
  const rate = ((lastBar.close - source.close) / source.close) * 100
  return `(${period}|${rate.toFixed(2)}%)`
}

function clearSelectedDateMarker() {
  if (!chart.value || !markerOverlayId.value) return
  chart.value.removeOverlay({ id: markerOverlayId.value })
  markerOverlayId.value = null
}

function updateSelectedDateMarker() {
  if (!chart.value) return
  clearSelectedDateMarker()
  if (!props.markerTimestamp || props.chartType === 'area') return
  const source = props.bars.find((bar) => bar.timestamp === props.markerTimestamp)
  if (!source) return
  const overlayId = chart.value.createOverlay(
    {
      name: SELECTED_DATE_MARKER,
      lock: true,
      visible: true,
      zLevel: 10,
      points: [{ timestamp: source.timestamp, value: source.high }]
    },
    'candle_pane'
  )
  markerOverlayId.value = Array.isArray(overlayId) ? overlayId[0] : overlayId
}

function normalizeLockedDataIndex() {
  if (lockedDataIndex.value == null) return
  if (!props.bars.length) {
    lockedDataIndex.value = null
    return
  }
  lockedDataIndex.value = Math.max(0, Math.min(props.bars.length - 1, lockedDataIndex.value))
}

function updateNativeCrosshair() {
  if (lockedDataIndex.value == null || props.chartType === 'area') return
  const source = props.bars[lockedDataIndex.value]
  if (!source) return
  const coordinate = chart.value?.convertToPixel(
    { timestamp: source.timestamp, value: source.close },
    { paneId: 'candle_pane' }
  ) as { x?: number; y?: number }
  if (typeof coordinate?.x !== 'number' || typeof coordinate?.y !== 'number') return
  chart.value.executeAction(ActionType.OnCrosshairChange, {
    x: coordinate.x,
    y: coordinate.y,
    paneId: 'candle_pane'
  })
}

function lockCurrentCrosshair() {
  if (props.chartType === 'area' || hoverDataIndex.value == null) return
  lockedDataIndex.value = Math.max(0, Math.min(props.bars.length - 1, hoverDataIndex.value))
  chartRoot.value?.focus()
  updateNativeCrosshair()
}

function unlockCrosshair() {
  lockedDataIndex.value = null
}

function moveLockedCrosshair(step: number) {
  if (!props.bars.length) return
  const startIndex = lockedDataIndex.value ?? hoverDataIndex.value ?? props.bars.length - 1
  lockedDataIndex.value = Math.max(0, Math.min(props.bars.length - 1, startIndex + step))
  keepLockedCrosshairInView(step)
  updateNativeCrosshair()
}

function keepLockedCrosshairInView(step: number) {
  if (!chart.value || lockedDataIndex.value == null) return
  const visibleRange = chart.value.getVisibleRange()
  const barSpace = chart.value.getBarSpace()
  const edgeBuffer = 4
  const leftEdge = Math.ceil(visibleRange.from) + edgeBuffer
  const rightEdge = Math.floor(visibleRange.to) - edgeBuffer

  if (step < 0 && lockedDataIndex.value <= leftEdge && visibleRange.from > 0) {
    chart.value.scrollByDistance(barSpace, 0)
  } else if (step > 0 && lockedDataIndex.value >= rightEdge && visibleRange.to < props.bars.length - 1) {
    chart.value.scrollByDistance(-barSpace, 0)
  }
}

function zoomLockedCrosshair(scale: number) {
  if (!chart.value || !props.bars.length) return
  const dataIndex = lockedDataIndex.value ?? hoverDataIndex.value ?? props.bars.length - 1
  lockedDataIndex.value = Math.max(0, Math.min(props.bars.length - 1, dataIndex))
  chart.value.zoomAtDataIndex(scale, lockedDataIndex.value, 0)
  updateNativeCrosshair()
}

function handleKeydown(event: KeyboardEvent) {
  if (props.chartType === 'area') return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveLockedCrosshair(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveLockedCrosshair(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    zoomLockedCrosshair(1.15)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    zoomLockedCrosshair(0.87)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    unlockCrosshair()
  }
}

function handleCrosshairChange(data?: { dataIndex?: number }) {
  if (typeof data?.dataIndex === 'number') {
    hoverDataIndex.value = data.dataIndex
    if (lockedDataIndex.value != null) {
      lockedDataIndex.value = data.dataIndex
    }
  }
}

onMounted(() => {
  if (!container.value) return
  registerSelectedDateMarker()
  chart.value = init(container.value, {
    locale: 'zh-CN-custom',
    layout: props.showVolume ? candleLayout : undefined,
    customApi: {
      formatDate: (_dateTimeFormat, timestamp) =>
        props.chartType === 'area' ? formatTimeOnly(timestamp) : formatDateOnly(timestamp)
    },
    styles: {
      grid: {
        show: true,
        horizontal: { color: '#edf1f7' },
        vertical: { color: '#edf1f7' }
      },
      candle: {
        type: props.chartType === 'area' ? CandleType.Area : CandleType.CandleSolid,
        bar: {
          upColor: '#d92d20',
          downColor: '#039855',
          noChangeColor: '#667085',
          upBorderColor: '#d92d20',
          downBorderColor: '#039855',
          upWickColor: '#d92d20',
          downWickColor: '#039855'
        },
        priceMark: {
          high: { color: '#667085' },
          low: { color: '#667085' },
          last: {
            show: false,
            line: { show: false },
            text: { show: false }
          }
        },
        tooltip: {
          showRule: props.chartType === 'area' ? TooltipShowRule.None : TooltipShowRule.Always,
          custom: ({ current }: { current: ChartBar }) => createTooltip(current)
        }
      },
      indicator: {
        lastValueMark: { show: false },
        tooltip: {
          showName: true,
          showParams: false
        }
      },
      xAxis: { axisLine: { color: '#d0d5dd' }, tickText: { color: '#667085' } },
      yAxis: { axisLine: { color: '#d0d5dd' }, tickText: { color: '#667085' } },
      crosshair: {
        horizontal: { line: { color: '#7c3aed' }, text: { backgroundColor: '#344054' } },
        vertical: { line: { color: '#7c3aed' }, text: { backgroundColor: '#344054' } }
      }
    }
  })
  applyData()
  if (props.showVolume) {
    chart.value.createIndicator({ name: 'MA', shortName: '均线', calcParams: [5, 10, 20, 60] }, true, {
      id: 'candle_pane'
    })
  }
  if (props.showVolume) {
    chart.value.createIndicator({ name: 'VOL', shortName: '成交量', shouldFormatBigNumber: false }, false, {
      height: 86
    })
  }
  chart.value.subscribeAction(ActionType.OnCrosshairChange, handleCrosshairChange)
  updateSelectedDateMarker()
})

watch(() => props.bars, applyData, { deep: true })
watch(() => props.markerTimestamp, updateSelectedDateMarker)

onBeforeUnmount(() => {
  clearSelectedDateMarker()
  chart.value?.unsubscribeAction(ActionType.OnCrosshairChange, handleCrosshairChange)
  dispose(chartId)
  if (container.value) dispose(container.value)
})
</script>

<template>
  <section class="chart-card">
    <div class="chart-card-head">
      <strong>{{ title }}</strong>
      <small>{{ legend }}</small>
    </div>
    <div class="chart-wrap" :class="{ 'with-side': $slots.side }" :style="{ height: `${height ?? 300}px` }">
      <div
        ref="chartRoot"
        class="chart-main kline-chart-main"
        tabindex="0"
        @click="lockCurrentCrosshair"
        @keydown="handleKeydown"
      >
        <div :id="chartId" ref="container" class="chart-canvas" />
        <div v-if="!bars.length" class="chart-empty">{{ emptyText ?? '暂无图表数据' }}</div>
      </div>
      <aside v-if="$slots.side" class="chart-side">
        <slot name="side" />
      </aside>
    </div>
  </section>
</template>
