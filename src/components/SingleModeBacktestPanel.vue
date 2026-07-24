<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GitCompareArrows, LoaderCircle, Play, RefreshCw, Repeat2 } from 'lucide-vue-next'
import {
  fetchSingleModeBacktestRun,
  fetchSingleModeBacktestRuns,
  fetchSingleModeBacktestSummary,
  fetchSingleModeBoardStats,
  fetchSingleModeSamples,
  replaySingleModeBacktest,
  replaySingleModeCandidates,
  startSingleModeBacktest
} from '../api/market'
import type {
  SingleModeBacktestRun,
  SingleModeBacktestSample,
  SingleModeBacktestSummary,
  SingleModeBoardStat,
  SingleModeTradeMode
} from '../types/market'
import { isAbortError, RequestGate } from '../utils/requestGate'
import { ResilientPoller } from '../utils/resilientPoller'

const props = defineProps<{ defaultEndDate: string }>()
const emit = defineEmits<{ selectSample: [sample: SingleModeBacktestSample] }>()

const startDate = ref('')
const endDate = ref('')
const selectedTradeMode = ref<SingleModeTradeMode>(2)
const run = ref<SingleModeBacktestRun | null>(null)
const runs = ref<SingleModeBacktestRun[]>([])
const selectedRunId = ref<number | null>(null)
const summary = ref<SingleModeBacktestSummary | null>(null)
const boardStats = ref<SingleModeBoardStat[]>([])
const samples = ref<SingleModeBacktestSample[]>([])
const totalSamples = ref(0)
const page = ref(1)
const pageSize = 50
const selectedPositionType = ref<'' | 1 | 2>('')
const submitting = ref(false)
const replaying = ref<'execution' | 'candidates' | null>(null)
const loadingResults = ref(false)
const errorMessage = ref('')
const runListGate = new RequestGate()
const runDetailGate = new RequestGate()
const resultGate = new RequestGate()
const poller = new ResilientPoller(pollRun, {
  onError: (error) => {
    if (!isAbortError(error)) {
      errorMessage.value =
        error instanceof Error ? `单模式状态查询失败，正在重试：${error.message}` : '单模式状态查询失败，正在重试'
    }
  }
})

const modeOptions: Array<{ value: SingleModeTradeMode; label: string; detail: string }> = [
  { value: 1, label: 'Model 1 · 连板接力', detail: '二板、三板候选' },
  { value: 2, label: 'Model 2 · 普通首板', detail: '普通市值首板候选' },
  { value: 3, label: 'Model 3 · 小市值首板', detail: '小市值首板候选' }
]
const samplePositionOptions: Array<{ value: '' | 1 | 2; label: string }> = [
  { value: '', label: '全部样本' },
  { value: 1, label: '真实成交' },
  { value: 2, label: '虚拟卖出' }
]

watch(
  () => props.defaultEndDate,
  (date) => {
    if (!date || endDate.value) return
    endDate.value = date
    startDate.value = `${date.slice(0, 4)}-01-01`
  },
  { immediate: true }
)

const isRunning = computed(() => run.value?.status === 1)
const selectedMode = computed(
  () => modeOptions.find((item) => item.value === selectedTradeMode.value) ?? modeOptions[1]
)
const totalPages = computed(() => Math.max(1, Math.ceil(totalSamples.value / pageSize)))
const statusLabel = computed(() => {
  if (!run.value) return '未启动'
  return ({ 1: '回测进行中', 2: '已完成', 3: '执行失败' } as Record<number, string>)[run.value.status] ?? '未知状态'
})

async function startRun() {
  if (!startDate.value || !endDate.value || submitting.value || isRunning.value) return
  if (startDate.value > endDate.value) {
    errorMessage.value = '开始日期不能晚于结束日期'
    return
  }
  poller.stop()
  runDetailGate.invalidate()
  submitting.value = true
  errorMessage.value = ''
  try {
    const nextRun = await startSingleModeBacktest(startDate.value, endDate.value, selectedTradeMode.value)
    clearResults()
    run.value = nextRun
    selectedRunId.value = nextRun.id
    await loadRuns(false)
    startPolling()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `启动 ${selectedMode.value.label} 回测失败`
  } finally {
    submitting.value = false
  }
}

async function loadRuns(autoSelect = true) {
  const request = runListGate.begin()
  const tradeMode = selectedTradeMode.value
  try {
    const rows = await fetchSingleModeBacktestRuns(tradeMode, 20, request.signal)
    if (!runListGate.isCurrent(request.id) || tradeMode !== selectedTradeMode.value) return
    runs.value = rows
    if (autoSelect && !selectedRunId.value && runs.value.length) {
      selectedRunId.value = runs.value[0].id
      await selectRun()
    }
  } catch (error) {
    if (isAbortError(error) || !runListGate.isCurrent(request.id) || tradeMode !== selectedTradeMode.value) return
    errorMessage.value = error instanceof Error ? error.message : '单模式任务列表加载失败'
  }
}

watch(selectedTradeMode, async () => {
  runListGate.invalidate()
  runDetailGate.invalidate()
  poller.stop()
  run.value = null
  runs.value = []
  selectedRunId.value = null
  errorMessage.value = ''
  clearResults()
  await loadRuns()
})

async function selectRun() {
  if (!selectedRunId.value) return
  const request = runDetailGate.begin()
  const runId = selectedRunId.value
  const tradeMode = selectedTradeMode.value
  poller.stop()
  clearResults()
  errorMessage.value = ''
  try {
    const nextRun = await fetchSingleModeBacktestRun(runId, request.signal)
    if (
      !runDetailGate.isCurrent(request.id) ||
      runId !== selectedRunId.value ||
      tradeMode !== selectedTradeMode.value ||
      nextRun.tradeMode !== tradeMode
    )
      return
    run.value = nextRun
    startDate.value = nextRun.startDate
    endDate.value = nextRun.endDate
    if (nextRun.status === 2) await loadResults()
    else if (nextRun.status === 1) startPolling()
  } catch (error) {
    if (isAbortError(error) || !runDetailGate.isCurrent(request.id) || tradeMode !== selectedTradeMode.value) return
    errorMessage.value = error instanceof Error ? error.message : '单模式任务加载失败'
  }
}

function startPolling() {
  if (!run.value?.id) return
  poller.start()
}

async function pollRun(): Promise<boolean> {
  const runId = run.value?.id
  if (!runId) return false
  const request = runDetailGate.begin()
  const tradeMode = selectedTradeMode.value
  const nextRun = await fetchSingleModeBacktestRun(runId, request.signal)
  if (
    !runDetailGate.isCurrent(request.id) ||
    runId !== run.value?.id ||
    tradeMode !== selectedTradeMode.value ||
    nextRun.tradeMode !== tradeMode
  )
    return false
  run.value = nextRun
  errorMessage.value = ''
  if (nextRun.status === 2) {
    await loadResults()
    await loadRuns(false)
    return false
  }
  return nextRun.status === 1
}

async function refreshRun() {
  poller.stop()
  try {
    if (await pollRun()) startPolling()
  } catch (error) {
    if (isAbortError(error)) return
    errorMessage.value = error instanceof Error ? error.message : '单模式回测状态查询失败'
    if (isRunning.value) startPolling()
  }
}

async function loadResults() {
  if (!run.value?.id) return
  const request = resultGate.begin()
  const runId = run.value.id
  const tradeMode = selectedTradeMode.value
  const positionType = selectedPositionType.value
  loadingResults.value = true
  try {
    const [summaryRow, boardRows, samplePage] = await Promise.all([
      fetchSingleModeBacktestSummary(runId, request.signal),
      fetchSingleModeBoardStats(runId, request.signal),
      fetchSingleModeSamples(runId, page.value, pageSize, positionType || undefined, request.signal)
    ])
    if (
      !resultGate.isCurrent(request.id) ||
      runId !== run.value?.id ||
      tradeMode !== selectedTradeMode.value ||
      run.value.tradeMode !== tradeMode ||
      positionType !== selectedPositionType.value
    )
      return
    summary.value = summaryRow
    boardStats.value = boardRows
    samples.value = samplePage.records
    totalSamples.value = samplePage.total
  } catch (error) {
    if (isAbortError(error) || !resultGate.isCurrent(request.id) || tradeMode !== selectedTradeMode.value) return
    errorMessage.value = error instanceof Error ? error.message : '单模式回测结果加载失败'
  } finally {
    if (resultGate.isCurrent(request.id)) loadingResults.value = false
  }
}

/** Starts a comparable replay without changing the source run's candidate facts. */
async function startReplay(kind: 'execution' | 'candidates') {
  if (!run.value || run.value.status !== 2 || replaying.value) return
  const sourceRunId = run.value.id
  replaying.value = kind
  poller.stop()
  runDetailGate.invalidate()
  errorMessage.value = ''
  try {
    const nextRun =
      kind === 'execution' ? await replaySingleModeBacktest(sourceRunId) : await replaySingleModeCandidates(sourceRunId)
    clearResults()
    run.value = nextRun
    selectedTradeMode.value = nextRun.tradeMode
    selectedRunId.value = nextRun.id
    await loadRuns(false)
    startPolling()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '固定样本重放启动失败'
  } finally {
    replaying.value = null
  }
}

async function changePage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  await loadResults()
}

async function changeSamplePositionType() {
  page.value = 1
  await loadResults()
}

function clearResults() {
  resultGate.invalidate()
  summary.value = null
  boardStats.value = []
  samples.value = []
  totalSamples.value = 0
  page.value = 1
}

function formatRate(value?: number) {
  return `${Number(value ?? 0).toFixed(2)}%`
}

function formatPrice(value?: number) {
  return value ? (value / 100).toFixed(2) : '-'
}

function sampleStatus(sample: SingleModeBacktestSample) {
  return (
    ({ 1: '待处理', 2: '未买入', 3: '持仓至末日', 4: '已卖出', 5: '数据异常' } as Record<number, string>)[
      sample.status
    ] ?? '未知'
  )
}

function sampleStatusClass(sample: SingleModeBacktestSample) {
  return `sample-status-${sample.status}`
}

function selectionTriggerLabel(value?: string) {
  return (
    (
      {
        HEIGHT_SUPPRESSION: '高度压制',
        HIGH_TO_LOW_SECOND: '高切低二次',
        HIGH_TO_LOW_BREAK: '高切低断板',
        WEAK_FIVE_CARD: '弱五板卡位（兜底）'
      } as Record<string, string>
    )[value ?? ''] ??
    value ??
    '-'
  )
}

function selectionStrengthLabel(value?: string) {
  return (
    (
      {
        STRICT: '严谨',
        NORMAL: '一般',
        RELAXED: '宽松'
      } as Record<string, string>
    )[value ?? ''] ??
    value ??
    '-'
  )
}

function compactTime(value?: number) {
  if (value == null) return ''
  const text = String(value).padStart(9, '0')
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`
}

onMounted(() => loadRuns())
onBeforeUnmount(() => {
  poller.stop()
  runListGate.invalidate()
  runDetailGate.invalidate()
  resultGate.invalidate()
})
</script>

<template>
  <section class="single-mode-panel panel" :aria-label="`${selectedMode.label} 单模式全量回测`">
    <div class="single-mode-controls">
      <fieldset class="mode-switch" :disabled="submitting || Boolean(replaying)">
        <legend>回测模式</legend>
        <label
          v-for="option in modeOptions"
          :key="option.value"
          :class="{ active: selectedTradeMode === option.value }"
        >
          <input v-model="selectedTradeMode" type="radio" name="single-mode" :value="option.value" />
          <span>
            <b>{{ option.label }}</b>
            <small>{{ option.detail }}</small>
          </span>
        </label>
      </fieldset>
      <label>
        历史任务
        <select v-model="selectedRunId" @change="selectRun">
          <option :value="null">选择 runId 查看</option>
          <option v-for="item in runs" :key="item.id" :value="item.id">
            #{{ item.id }} · {{ item.startDate }} 至 {{ item.endDate }} ·
            {{ item.status === 2 ? '完成' : item.status === 3 ? '失败' : '执行中' }}
          </option>
        </select>
      </label>
      <label>
        开始日期
        <input v-model="startDate" type="date" :disabled="isRunning" />
      </label>
      <label>
        结束日期
        <input v-model="endDate" type="date" :disabled="isRunning" />
      </label>
      <button
        class="single-mode-start"
        type="button"
        :disabled="!startDate || !endDate || submitting || Boolean(replaying) || isRunning"
        @click="startRun"
      >
        <LoaderCircle v-if="submitting || isRunning" :size="15" class="spinning" />
        <Play v-else :size="15" />
        {{ isRunning ? '回测进行中' : `启动 ${selectedMode.label} 全量回测` }}
      </button>
      <button v-if="run" class="single-mode-refresh" type="button" :disabled="loadingResults" @click="refreshRun">
        <RefreshCw :size="15" :class="{ spinning: loadingResults }" />
      </button>
      <button
        v-if="run?.status === 2"
        class="single-mode-replay"
        type="button"
        :disabled="Boolean(replaying)"
        title="固定原任务的真实买入事实，仅重放卖出执行，适合验证卖出策略变化"
        @click="startReplay('execution')"
      >
        <Repeat2 :size="15" :class="{ spinning: replaying === 'execution' }" />
        固定买入重放
      </button>
      <button
        v-if="run?.status === 2"
        class="single-mode-replay candidates"
        type="button"
        :disabled="Boolean(replaying)"
        title="固定原任务候选集，重新执行买卖两侧，适合验证完整策略变化"
        @click="startReplay('candidates')"
      >
        <GitCompareArrows :size="15" :class="{ spinning: replaying === 'candidates' }" />
        固定候选重放
      </button>
    </div>

    <div v-if="run" class="single-mode-status" :class="`run-status-${run.status}`">
      <b>{{ statusLabel }}</b>
      <span>{{ selectedMode.label }}</span>
      <span>#{{ run.id }} · {{ run.startDate }} 至 {{ run.endDate }}</span>
      <span v-if="run.strategyVersion">策略 {{ run.strategyVersion }}</span>
      <span v-if="run.sourceRunId">来源 run #{{ run.sourceRunId }}</span>
      <span>样本 {{ run.processedSamples ?? 0 }} / {{ run.totalSamples ?? 0 }}</span>
      <span v-if="run.lastCompletedDate">选股处理到 {{ run.lastCompletedDate }}</span>
      <em v-if="run.errorMessage">{{ run.errorMessage }}</em>
    </div>
    <p v-if="errorMessage" class="single-mode-error">{{ errorMessage }}</p>

    <template v-if="summary">
      <div class="single-mode-summary">
        <article>
          <span>全样本 / 真实成交</span>
          <b>{{ summary.totalSamples }} / {{ summary.boughtSamples }}</b>
          <small>买入率 {{ formatRate(summary.buyRate) }}</small>
        </article>
        <article>
          <span>平仓胜率</span>
          <b :class="summary.closeWinRate >= 50 ? 'positive' : 'negative'">{{ formatRate(summary.closeWinRate) }}</b>
          <small>平均收益 {{ formatRate(summary.averageReturnRate) }}</small>
        </article>
        <article>
          <span>首次晋级触板率</span>
          <b>{{ formatRate(summary.nextBoardTouchRate) }}</b>
          <small>按各样本推荐板位</small>
        </article>
        <article>
          <span>触板后封板率</span>
          <b>{{ formatRate(summary.nextBoardSealRate) }}</b>
          <small>炸板率 {{ formatRate(summary.nextBoardBreakRate) }}</small>
        </article>
        <article>
          <span>真实成交封板率</span>
          <b>{{ formatRate(summary.actualEntrySealRate) }}</b>
          <small>仅统计真实成交样本</small>
        </article>
        <article>
          <span>理论最高收益均值</span>
          <b>{{ formatRate(summary.averagePotentialMaxReturnRate) }}</b>
          <small>按本轮最高价</small>
        </article>
        <article>
          <span>虚拟样本 / 平仓</span>
          <b>{{ summary.virtualSamples }} / {{ summary.virtualClosedSamples }}</b>
          <small>虚拟胜率 {{ formatRate(summary.virtualCloseWinRate) }}</small>
        </article>
        <article>
          <span>虚拟平均收益</span>
          <b>{{ formatRate(summary.virtualAverageReturnRate) }}</b>
          <small>虚拟入口封板率 {{ formatRate(summary.virtualEntrySealRate) }}</small>
        </article>
        <article>
          <span>合并场景胜率</span>
          <b>{{ formatRate(summary.scenarioCloseWinRate) }}</b>
          <small>真实与虚拟场景合并</small>
        </article>
        <article>
          <span>合并场景收益</span>
          <b>{{ formatRate(summary.scenarioAverageReturnRate) }}</b>
          <small>不可替代逐笔一致性校验</small>
        </article>
      </div>

      <section class="board-stat-section">
        <header>
          <strong>逐板晋级统计</strong>
          <small>封板率与炸板率以“已触板”为分母</small>
        </header>
        <div class="board-stat-table">
          <div class="board-stat-head">
            <span>晋级</span>
            <span>可晋级</span>
            <span>触板</span>
            <span>封板</span>
            <span>炸板</span>
            <span>触板率</span>
            <span>封板率</span>
            <span>炸板率</span>
          </div>
          <article v-for="stat in boardStats" :key="stat.fromBoard">
            <b>{{ stat.fromBoard }} 晋 {{ stat.fromBoard + 1 }}</b>
            <span>{{ stat.eligibleCount }}</span>
            <span>{{ stat.touchCount }}</span>
            <span>{{ stat.sealedCount }}</span>
            <span>{{ stat.breakCount }}</span>
            <em>{{ formatRate(stat.touchRate) }}</em>
            <em>{{ formatRate(stat.sealRate) }}</em>
            <em>{{ formatRate(stat.breakRate) }}</em>
          </article>
        </div>
      </section>

      <section class="sample-section">
        <header>
          <div class="sample-section-title">
            <strong>全部买卖样本</strong>
            <label>
              <span>样本类型</span>
              <select v-model="selectedPositionType" :disabled="loadingResults" @change="changeSamplePositionType">
                <option v-for="option in samplePositionOptions" :key="String(option.value)" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>
          <small>{{ totalSamples }} 只 · 点击股票查看买入日 K 与分时</small>
        </header>
        <div class="sample-table">
          <div class="sample-head">
            <span>推荐 / 股票</span>
            <span>选股链</span>
            <span>状态</span>
            <span>买卖点</span>
            <span>实际收益</span>
            <span>本轮高度</span>
            <span>最高收益 / 回撤</span>
            <span>执行规则</span>
          </div>
          <article v-for="sample in samples" :key="sample.id">
            <span class="sample-stock">
              <small>{{ sample.recommendDate }}</small>
              <button type="button" @click="emit('selectSample', sample)">
                {{ sample.symbolName || sample.symbol }}
              </button>
              <i>{{ sample.symbol }}</i>
            </span>
            <span class="selection-chain">
              <small>{{ selectionTriggerLabel(sample.selectionTrigger) }}</small>
              <i>→</i>
              <b>{{ sample.selectionBoard }} 板</b>
              <i>→</i>
              <small>{{ selectionStrengthLabel(sample.selectionStrength) }}</small>
            </span>
            <span>
              <b class="sample-status" :class="sampleStatusClass(sample)">{{ sampleStatus(sample) }}</b>
              <small v-if="sample.noBuyReason" :title="sample.noBuyReason">{{ sample.noBuyReason }}</small>
            </span>
            <span>
              <small>
                买 {{ sample.buyDate || '-' }} {{ compactTime(sample.buyTime) }} · {{ formatPrice(sample.buyPrice) }}
              </small>
              <small>
                卖 {{ sample.sellDate || '-' }} {{ compactTime(sample.sellTime) }} · {{ formatPrice(sample.sellPrice) }}
              </small>
            </span>
            <span>
              <b :class="Number(sample.returnRate ?? 0) >= 0 ? 'positive' : 'negative'">
                {{ sample.returnRate == null ? '-' : formatRate(sample.returnRate) }}
              </b>
              <small>持有 {{ sample.holdingTradeDays }} 天</small>
            </span>
            <span>
              <b>{{ sample.maxSealedBoards }} 连板</b>
              <small v-if="sample.maxTouchedBoards > sample.maxSealedBoards">
                最高触及 {{ sample.maxTouchedBoards }} 板
              </small>
              <small v-else>完整封板</small>
            </span>
            <span>
              <b>{{ formatRate(sample.potentialMaxReturnRate) }}</b>
              <small>
                实际浮盈 {{ formatRate(sample.maxFloatingReturnRate) }} · 回撤 {{ formatRate(sample.maxDrawdownRate) }}
              </small>
            </span>
            <span>
              <small>买 {{ sample.buyRuleCode ?? '-' }} · 卖 {{ sample.sellRuleCode ?? '-' }}</small>
              <small v-if="sample.sellRemark" :title="sample.sellRemark">{{ sample.sellRemark }}</small>
            </span>
          </article>
        </div>
        <footer v-if="totalPages > 1" class="sample-pagination">
          <button type="button" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button type="button" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button>
        </footer>
      </section>
    </template>
    <p v-else-if="run?.status === 2 && !loadingResults" class="single-mode-empty">
      本轮没有 {{ selectedMode.label }} 样本
    </p>
  </section>
</template>

<style scoped>
.single-mode-panel {
  padding: 14px;
  border-top-left-radius: 0;
}
.single-mode-controls {
  display: flex;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
}
.single-mode-controls label {
  display: grid;
  gap: 5px;
  color: #667085;
  font-size: 12px;
}
.single-mode-controls input,
.single-mode-controls select {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #d8dee9;
  border-radius: 7px;
  background: #fff;
  color: #172033;
}
.single-mode-controls select {
  min-width: 245px;
}
.mode-switch {
  min-width: 590px;
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
}
.mode-switch legend {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.mode-switch label {
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border: 1px solid #d8dee9;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.mode-switch label.active {
  border-color: #9bb7f5;
  background: #f4f7ff;
}
.mode-switch input {
  width: 15px;
  height: 15px;
  min-height: 0;
  padding: 0;
  accent-color: #3157a8;
}
.mode-switch span {
  display: grid;
  gap: 2px;
}
.mode-switch b {
  color: #3157a8;
  font-size: 12px;
}
.mode-switch small {
  color: #667085;
  font-size: 10px;
}
.single-mode-start,
.single-mode-refresh,
.single-mode-replay {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 7px;
  padding: 0 13px;
  cursor: pointer;
}
.single-mode-start {
  background: #3157a8;
  color: #fff;
  font-weight: 700;
}
.single-mode-refresh {
  background: #eef2f7;
  color: #475467;
}
.single-mode-replay {
  border: 1px solid #c9d6f4;
  background: #f4f7ff;
  color: #3157a8;
  font-weight: 700;
}
.single-mode-replay.candidates {
  border-color: #d7c9f4;
  background: #f8f5ff;
  color: #6941c6;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.single-mode-status {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: 7px;
  background: #f8fafc;
  color: #667085;
  font-size: 12px;
}
.single-mode-status b {
  color: #3157a8;
}
.run-status-2 b {
  color: #18864b;
}
.run-status-3 b,
.single-mode-status em {
  color: #c9393f;
}
.single-mode-error {
  color: #c9393f;
  font-size: 12px;
}
.single-mode-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(125px, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.single-mode-summary article {
  display: grid;
  gap: 3px;
  min-height: 76px;
  padding: 10px;
  border: 1px solid #e4e8ef;
  border-radius: 8px;
  background: #fff;
}
.single-mode-summary span,
.single-mode-summary small {
  color: #7a8495;
  font-size: 11px;
}
.single-mode-summary b {
  color: #172033;
  font-size: 17px;
}
.positive {
  color: #d23b43 !important;
}
.negative {
  color: #18864b !important;
}
.board-stat-section,
.sample-section {
  margin-top: 13px;
  border: 1px solid #e4e8ef;
  border-radius: 9px;
  overflow: hidden;
  background: #fff;
}
.board-stat-section > header,
.sample-section > header {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px;
  background: #f8fafc;
}
.board-stat-section header small,
.sample-section header small {
  color: #7a8495;
}
.sample-section > header {
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sample-section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.sample-section-title label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #667085;
  font-size: 12px;
}
.sample-section-title select {
  min-height: 30px;
  padding: 0 26px 0 9px;
  border: 1px solid #d8dee9;
  border-radius: 7px;
  background: #fff;
  color: #172033;
}
.board-stat-head,
.board-stat-table article {
  display: grid;
  grid-template-columns: 1.1fr repeat(7, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
}
.board-stat-head {
  color: #7a8495;
  background: #fbfcfe;
}
.board-stat-table article {
  border-top: 1px solid #edf0f4;
}
.board-stat-table em {
  color: #3157a8;
  font-style: normal;
}
.sample-table {
  overflow-x: auto;
}
.sample-head,
.sample-table article {
  min-width: 1180px;
  display: grid;
  grid-template-columns: 1.2fr 1fr 0.8fr 1.55fr 0.75fr 0.8fr 1.2fr 1.25fr;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  font-size: 12px;
}
.sample-head {
  color: #7a8495;
  background: #fbfcfe;
}
.sample-table article {
  border-top: 1px solid #edf0f4;
}
.sample-table article:hover {
  background: #fafcff;
}
.sample-table article > span {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.selection-chain {
  grid-template-columns: minmax(0, 1fr) auto auto auto minmax(0, 0.7fr);
  align-items: center;
}
.selection-chain i {
  color: #98a2b3;
  font-style: normal;
}
.sample-table small {
  overflow: hidden;
  color: #7a8495;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sample-stock button {
  width: fit-content;
  padding: 0;
  border: 0;
  background: none;
  color: #3157a8;
  font-weight: 700;
  cursor: pointer;
}
.sample-stock i {
  color: #98a2b3;
  font-style: normal;
  font-size: 11px;
}
.sample-status {
  width: fit-content;
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 11px;
}
.sample-status-2 {
  background: #f2f4f7;
  color: #667085;
}
.sample-status-3 {
  background: #fff4e7;
  color: #b8670b;
}
.sample-status-4 {
  background: #eaf8f0;
  color: #18864b;
}
.sample-status-5 {
  background: #fff0f1;
  color: #c9393f;
}
.sample-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-top: 1px solid #edf0f4;
}
.sample-pagination button {
  border: 1px solid #d8dee9;
  border-radius: 6px;
  background: #fff;
  padding: 5px 10px;
}
.single-mode-empty {
  padding: 30px;
  text-align: center;
  color: #7a8495;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1400px) {
  .single-mode-summary {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 900px) {
  .mode-switch {
    min-width: 100%;
    display: grid;
    grid-template-columns: 1fr;
  }
  .mode-switch label {
    min-width: 0;
  }
}
</style>
