# Compound Wonder UI

面向 A 股 Level2 看盘、单股订单簿回放和历史策略回测的 Vue 3 前端。默认配套
`CompoundWonder-parent/cw-app-backtest`，浏览器通过 Vite 代理访问 `/cw/backtest`。

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

默认后端地址是 `http://127.0.0.1:18818`。如端口不同，只修改 `.env.local`：

```dotenv
VITE_BACKEND_TARGET=http://127.0.0.1:18818
VITE_API_BASE=/cw/backtest
```

环境变量文件、`node_modules/` 和 `dist/` 均不会提交到 Git。不要把数据库账号、令牌或
生产地址写进 `VITE_*` 变量：这类变量会进入浏览器构建产物。

## 主要功能

- 按交易日查看推荐、涨停、炸板/断板股票池和市场情绪。
- 展示日 K、Level2 分时、集合竞价量柱和订单簿回放规则。
- 运行多模式混合历史回测，查看权益、持仓生命周期和实际执行规则。
- 运行三类单模式全量回测，并查看逐板晋级、真实成交、虚拟样本和合并场景指标。
- 对已完成的单模式 run 执行“固定买入重放”或“固定候选重放”，并保留
  `sourceRunId` 与 `strategyVersion`，用于逐笔一致性对比。

固定买入重放只验证卖出执行变化；固定候选重放会在同一候选集上重新执行买卖两侧。
聚合收益率和胜率不能替代逐笔业务字段的一致性检查。

## 质量检查

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

也可使用 `npm run check` 一次执行类型、测试、Lint 和格式检查。测试重点覆盖：

- 旧请求被取消，只有最新请求可以写入页面状态。
- 回测轮询遇到短暂失败后按上限退避重试，完成后停止。
- 沪深主板、创业板、科创板、北交所及历史 ST 的涨跌幅显示规则。

## 数据契约

前端优先使用日 K 接口返回的 `historySt`、`priceLimitRate` 和 `noPriceLimit`。
后端未返回这些字段时，才按股票池历史状态、名称和板块规则降级推断。新股无涨跌幅限制等
特殊交易日应由后端提供明确事实，避免前端根据不完整历史数据猜测。

所有行情和回测请求均带代际隔离；切换日期、股票、模式或 run 后，旧响应不会覆盖当前页面。
轮询在普通页面标签切换时继续运行，组件卸载或切换任务时才会停止。
