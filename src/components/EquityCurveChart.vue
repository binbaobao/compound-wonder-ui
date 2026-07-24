<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HistoricalBacktestDailyRecord } from '../types/market'
import {
  buildEquityChartModel,
  nearestEquityPointIndex,
  panEquityRange,
  zoomEquityRange,
  type EquityChartPoint,
  type EquityChartRange,
  type EquityZoomDirection
} from '../utils/equityChart'

const props = defineProps<{
  records: HistoricalBacktestDailyRecord[]
  loading?: boolean
}>()

const svg = ref<SVGSVGElement | null>(null)
const activeIndex = ref<number | null>(null)
const zoomRange = ref<EquityChartRange | null>(null)
const dragState = ref<{
  pointerId: number
  startClientX: number
  range: EquityChartRange
} | null>(null)
const visibleRange = computed<EquityChartRange>(() => {
  const total = props.records.length
  if (!total) return { start: 0, end: 0 }
  const range = zoomRange.value
  if (!range) return { start: 0, end: total }
  const start = Math.min(total - 1, Math.max(0, range.start))
  return {
    start,
    end: Math.min(total, Math.max(start + 1, range.end))
  }
})
const visibleRecords = computed(() => {
  const range = visibleRange.value
  return props.records.slice(range.start, range.end)
})
const chart = computed(() => buildEquityChartModel(visibleRecords.value))
const activePoint = computed(() => {
  const model = chart.value
  const index = activeIndex.value
  return model && index != null ? (model.points[index] ?? null) : null
})
const latestPoint = computed(() => {
  for (let index = props.records.length - 1; index >= 0; index -= 1) {
    const record = props.records[index]
    if (Number.isFinite(Number(record.cumulativeReturnRate))) return record
  }
  return null
})
const lineTone = computed(() => (Number(latestPoint.value?.cumulativeReturnRate ?? 0) >= 0 ? 'gain' : 'loss'))
const isZoomed = computed(() => {
  const range = visibleRange.value
  return range.start > 0 || range.end < props.records.length
})
const isDragging = computed(() => dragState.value != null)
const zoomStatus = computed(() => {
  const points = chart.value?.points
  if (!isZoomed.value || !points?.length) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${first.tradeDate} — ${last.tradeDate} · ${points.length}/${props.records.length} 个交易日`
})
const tooltipStyle = computed(() => {
  const model = chart.value
  const point = activePoint.value
  if (!model || !point) return {}
  return {
    left: `${(point.x / model.width) * 100}%`,
    top: `${(point.y / model.height) * 100}%`
  }
})

watch(
  () => props.records,
  () => {
    activeIndex.value = null
    zoomRange.value = null
    dragState.value = null
  }
)

function handlePointerMove(event: PointerEvent) {
  const model = chart.value
  const element = svg.value
  if (!model || !element) return
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) return

  const drag = dragState.value
  if (drag && drag.pointerId === event.pointerId) {
    const plotWidth = rect.width * ((model.right - model.left) / model.width)
    if (plotWidth <= 0) return
    const visibleCount = drag.range.end - drag.range.start
    const recordOffset = ((drag.startClientX - event.clientX) / plotWidth) * visibleCount
    const nextRange = panEquityRange(drag.range, props.records.length, recordOffset)
    const currentRange = visibleRange.value
    if (nextRange.start !== currentRange.start || nextRange.end !== currentRange.end) {
      zoomRange.value = nextRange
    }
    activeIndex.value = null
    event.preventDefault()
    return
  }

  const chartX = ((event.clientX - rect.left) / rect.width) * model.width
  activeIndex.value = nearestEquityPointIndex(model.points, chartX)
}

function handlePointerDown(event: PointerEvent) {
  const element = svg.value
  if (!element || !isZoomed.value || event.button !== 0 || !event.isPrimary) return
  dragState.value = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    range: { ...visibleRange.value }
  }
  activeIndex.value = null
  element.focus({ preventScroll: true })
  element.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function handlePointerUp(event: PointerEvent) {
  const drag = dragState.value
  const element = svg.value
  if (!drag || drag.pointerId !== event.pointerId || !element) return
  dragState.value = null
  if (element.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
  handlePointerMove(event)
}

function handlePointerCancel(event: PointerEvent) {
  const drag = dragState.value
  const element = svg.value
  if (!drag || drag.pointerId !== event.pointerId) return
  dragState.value = null
  if (element?.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
}

function handleFocus() {
  if (activeIndex.value == null && chart.value?.points.length) {
    activeIndex.value = chart.value.points.length - 1
  }
}

function applyZoom(direction: EquityZoomDirection, focusPoint: EquityChartPoint) {
  const range = visibleRange.value
  const focusIndex = range.start + focusPoint.index
  const nextRange = zoomEquityRange(range, props.records.length, focusIndex, direction)
  zoomRange.value = nextRange.start === 0 && nextRange.end === props.records.length ? null : nextRange
  const nextIndex = chart.value?.points.findIndex((point) => point.id === focusPoint.id) ?? -1
  activeIndex.value = nextIndex >= 0 ? nextIndex : null
}

function handleWheel(event: WheelEvent) {
  const model = chart.value
  const element = svg.value
  if (!model || !element || dragState.value || event.deltaY === 0) return
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) return
  const chartX = ((event.clientX - rect.left) / rect.width) * model.width
  const index = nearestEquityPointIndex(model.points, chartX)
  if (index == null) return
  const focusPoint = model.points[index]
  element.focus({ preventScroll: true })
  activeIndex.value = index
  applyZoom(event.deltaY < 0 ? 'in' : 'out', focusPoint)
}

function resetZoom() {
  const activeId = activePoint.value?.id
  dragState.value = null
  zoomRange.value = null
  if (activeId == null) return
  const nextIndex = chart.value?.points.findIndex((point) => point.id === activeId) ?? -1
  activeIndex.value = nextIndex >= 0 ? nextIndex : null
}

function handleKeydown(event: KeyboardEvent) {
  const count = chart.value?.points.length ?? 0
  if (!count) return
  const current = activeIndex.value ?? count - 1
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const focusPoint = chart.value?.points[current]
    if (focusPoint) applyZoom(event.key === 'ArrowUp' ? 'in' : 'out', focusPoint)
  } else if (event.key === 'ArrowLeft') activeIndex.value = Math.max(0, current - 1)
  else if (event.key === 'ArrowRight') activeIndex.value = Math.min(count - 1, current + 1)
  else if (event.key === 'Home') activeIndex.value = 0
  else if (event.key === 'End') activeIndex.value = count - 1
  else if (event.key === 'Escape') activeIndex.value = null
  else return
  event.preventDefault()
}

function formatRate(value?: number) {
  const rate = Number(value ?? 0) * 100
  return `${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%`
}

function formatMoney(value?: number) {
  return Number(value ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function rateClass(value?: number) {
  const rate = Number(value ?? 0)
  if (rate > 0) return 'gain'
  if (rate < 0) return 'loss'
  return 'flat'
}

function accountLabel(record: HistoricalBacktestDailyRecord) {
  return record.accountStatus === 1 ? `${record.symbolName || record.symbol || '股票'}持仓` : '空仓'
}

function tickAnchor(x: number) {
  const model = chart.value
  if (!model) return 'middle'
  if (Math.abs(x - model.left) < 1) return 'start'
  if (Math.abs(x - model.right) < 1) return 'end'
  return 'middle'
}
</script>

<template>
  <section class="equity-curve" aria-label="每日累计收益曲线">
    <div class="equity-curve-toolbar">
      <div>
        <span class="equity-curve-legend" :class="lineTone">
          <i></i>
          累计收益
        </span>
        <strong v-if="latestPoint" :class="rateClass(latestPoint.cumulativeReturnRate)">
          {{ formatRate(latestPoint.cumulativeReturnRate) }}
        </strong>
      </div>
      <div class="equity-curve-tools">
        <small v-if="zoomStatus" class="equity-zoom-status" aria-live="polite">{{ zoomStatus }}</small>
        <small>滚轮 / ↑↓ 缩放 · 放大后拖拽平移 · ←→ 切换</small>
        <button v-if="isZoomed" type="button" @click="resetZoom">重置</button>
      </div>
    </div>

    <div v-if="chart" class="equity-curve-scroll">
      <div class="equity-curve-surface" @pointerleave="activeIndex = null">
        <svg
          ref="svg"
          :viewBox="`0 0 ${chart.width} ${chart.height}`"
          preserveAspectRatio="none"
          role="img"
          tabindex="0"
          :class="{ 'is-pannable': isZoomed, 'is-dragging': isDragging }"
          :aria-label="
            activePoint
              ? `${activePoint.tradeDate}，累计收益${formatRate(activePoint.cumulativeReturnRate)}，当日收益${formatRate(activePoint.dailyReturnRate)}，总资产${formatMoney(activePoint.totalAsset)}。使用上下方向键缩放，放大后可左右拖拽平移，左右方向键切换交易日`
              : '每日累计收益曲线，移动鼠标查看，滚轮或上下方向键缩放，放大后可左右拖拽平移，左右方向键切换交易日'
          "
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="handlePointerUp"
          @pointercancel="handlePointerCancel"
          @lostpointercapture="handlePointerCancel"
          @wheel.prevent="handleWheel"
          @focus="handleFocus"
          @keydown="handleKeydown"
        >
          <defs>
            <linearGradient id="equityGainArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#d92d20" stop-opacity="0.22" />
              <stop offset="100%" stop-color="#d92d20" stop-opacity="0.01" />
            </linearGradient>
            <linearGradient id="equityLossArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#16803a" stop-opacity="0.18" />
              <stop offset="100%" stop-color="#16803a" stop-opacity="0.01" />
            </linearGradient>
            <filter id="equityLineGlow" x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="equityPlotClip">
              <rect
                :x="chart.left"
                :y="chart.top"
                :width="chart.right - chart.left"
                :height="chart.bottom - chart.top"
              />
            </clipPath>
          </defs>

          <line
            v-for="tick in chart.yTicks"
            :key="`y-${tick.value}`"
            :x1="chart.left"
            :x2="chart.right"
            :y1="tick.y"
            :y2="tick.y"
            class="equity-grid-line"
          />
          <line
            v-for="tick in chart.xTicks"
            :key="`x-${tick.label}`"
            :x1="tick.x"
            :x2="tick.x"
            :y1="chart.top"
            :y2="chart.bottom"
            class="equity-grid-line vertical"
          />
          <line :x1="chart.left" :x2="chart.right" :y1="chart.zeroY" :y2="chart.zeroY" class="equity-zero-line" />

          <g clip-path="url(#equityPlotClip)">
            <path
              :d="chart.areaPath"
              :fill="lineTone === 'gain' ? 'url(#equityGainArea)' : 'url(#equityLossArea)'"
              class="equity-area"
            />
            <path :d="chart.linePath" :class="['equity-curve-line', lineTone]" filter="url(#equityLineGlow)" />
          </g>

          <template v-if="activePoint">
            <line
              :x1="activePoint.x"
              :x2="activePoint.x"
              :y1="chart.top"
              :y2="chart.bottom"
              class="equity-hover-line"
            />
            <circle
              :cx="activePoint.x"
              :cy="activePoint.y"
              r="10"
              :class="['equity-hover-ring', rateClass(activePoint.cumulativeReturnRate)]"
            />
            <circle
              :cx="activePoint.x"
              :cy="activePoint.y"
              r="4.5"
              :class="['equity-hover-dot', rateClass(activePoint.cumulativeReturnRate)]"
            />
          </template>

          <text
            v-for="tick in chart.yTicks"
            :key="`label-y-${tick.value}`"
            :x="chart.left - 12"
            :y="tick.y + 4"
            text-anchor="end"
            class="equity-axis-label"
          >
            {{ formatRate(tick.value) }}
          </text>
          <text
            v-for="tick in chart.xTicks"
            :key="`label-x-${tick.label}`"
            :x="tick.x"
            :y="chart.height - 17"
            :text-anchor="tickAnchor(tick.x)"
            class="equity-axis-label date"
          >
            {{ tick.label }}
          </text>
        </svg>

        <aside
          v-if="activePoint"
          class="equity-hover-card"
          :class="{
            'align-left': activePoint.x < chart.width * 0.28,
            'align-right': activePoint.x > chart.width * 0.72,
            below: activePoint.y < chart.height * 0.34
          }"
          :style="tooltipStyle"
          aria-live="polite"
        >
          <header>
            <strong>{{ activePoint.tradeDate }}</strong>
            <b :class="rateClass(activePoint.cumulativeReturnRate)">
              {{ formatRate(activePoint.cumulativeReturnRate) }}
            </b>
          </header>
          <dl>
            <div>
              <dt>当日收益</dt>
              <dd :class="rateClass(activePoint.dailyReturnRate)">{{ formatRate(activePoint.dailyReturnRate) }}</dd>
            </div>
            <div>
              <dt>总资产</dt>
              <dd>{{ formatMoney(activePoint.totalAsset) }}</dd>
            </div>
            <div>
              <dt>账户状态</dt>
              <dd>{{ accountLabel(activePoint) }}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>

    <p v-else class="equity-curve-empty">{{ loading ? '正在加载回测结果' : '暂无每日权益数据' }}</p>
  </section>
</template>

<style scoped>
.equity-curve {
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: #fff;
}

.equity-curve-toolbar {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft);
  background: #f8fafc;
}

.equity-curve-toolbar > div,
.equity-curve-legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.equity-curve-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.equity-curve-legend,
.equity-curve-toolbar small {
  color: var(--muted);
  font-size: 11px;
}

.equity-zoom-status {
  overflow: hidden;
  max-width: 340px;
  color: var(--text) !important;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.equity-curve-tools button {
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: #fff;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.equity-curve-tools button:hover {
  border-color: #94a3b8;
  background: #f8fafc;
}

.equity-curve-tools button:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.48);
  outline-offset: 2px;
}

.equity-curve-legend i {
  width: 18px;
  height: 3px;
  border-radius: 999px;
  background: currentColor;
}

.equity-curve-legend.gain,
.gain {
  color: var(--red);
}

.equity-curve-legend.loss,
.loss {
  color: #16803a;
}

.flat {
  color: var(--muted);
}

.equity-curve-scroll {
  overflow-x: auto;
}

.equity-curve-surface {
  position: relative;
  min-width: 720px;
  aspect-ratio: 25 / 9;
  background:
    radial-gradient(circle at 18% 8%, rgba(59, 130, 246, 0.06), transparent 32%),
    linear-gradient(180deg, #fcfdff 0%, #fff 100%);
}

.equity-curve-surface svg {
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
  touch-action: pan-y;
}

.equity-curve-surface svg.is-pannable {
  cursor: grab;
}

.equity-curve-surface svg.is-dragging {
  cursor: grabbing;
  user-select: none;
}

.equity-curve-surface svg:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.38);
}

.equity-grid-line {
  stroke: #e8edf4;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.equity-grid-line.vertical {
  stroke-dasharray: 3 5;
}

.equity-zero-line {
  stroke: #94a3b8;
  stroke-width: 1.25;
  stroke-dasharray: 5 4;
  vector-effect: non-scaling-stroke;
}

.equity-area {
  pointer-events: none;
}

.equity-curve-line {
  fill: none;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.equity-curve-line.gain {
  stroke: var(--red);
}

.equity-curve-line.loss {
  stroke: #16803a;
}

.equity-hover-line {
  stroke: #64748b;
  stroke-width: 1;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}

.equity-hover-ring {
  opacity: 0.18;
}

.equity-hover-ring.gain,
.equity-hover-dot.gain {
  fill: var(--red);
}

.equity-hover-ring.loss,
.equity-hover-dot.loss {
  fill: #16803a;
}

.equity-hover-ring.flat,
.equity-hover-dot.flat {
  fill: #64748b;
}

.equity-hover-dot {
  stroke: #fff;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.equity-axis-label {
  fill: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.equity-axis-label.date {
  font-size: 10px;
  font-weight: 500;
}

.equity-hover-card {
  position: absolute;
  z-index: 2;
  width: 220px;
  padding: 11px 12px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 18px));
  backdrop-filter: blur(8px);
}

.equity-hover-card.align-left {
  transform: translate(8px, calc(-100% - 18px));
}

.equity-hover-card.align-right {
  transform: translate(calc(-100% - 8px), calc(-100% - 18px));
}

.equity-hover-card.below {
  transform: translate(-50%, 18px);
}

.equity-hover-card.below.align-left {
  transform: translate(8px, 18px);
}

.equity-hover-card.below.align-right {
  transform: translate(calc(-100% - 8px), 18px);
}

.equity-hover-card header,
.equity-hover-card dl div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.equity-hover-card header {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-soft);
}

.equity-hover-card header strong,
.equity-hover-card header b {
  font-size: 13px;
}

.equity-hover-card dl {
  display: grid;
  gap: 6px;
  margin: 8px 0 0;
}

.equity-hover-card dt {
  color: var(--muted);
  font-size: 11px;
}

.equity-hover-card dd {
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.equity-hover-card dd.gain {
  color: var(--red);
}

.equity-hover-card dd.loss {
  color: #16803a;
}

.equity-curve-empty {
  min-height: 280px;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 720px) {
  .equity-curve-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .equity-curve-tools {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
