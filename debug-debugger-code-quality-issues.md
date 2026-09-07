# Debug Session: debugger-code-quality-issues

- **Session ID**: `debugger-code-quality-issues`
- **Created At**: 2026-09-04
- **Status**: `[OPEN]`
- **Symptoms**: 运行 `npx jest --runInBand` 全量用例报告 **20 test suites failed / 111 tests failed**（此前只跑了 6 个套件未暴露问题）。关键报错：
  1. `TypeError: this.applyState is not a function` 在 `booking-manage-detail.js:1027`（handleSubmitHandover）和 `booking-detail.js:1095`（handleConfirmHandover）
  2. `ENOENT: no such file or directory` 大量测试文件仍读 `pages/vehicle-manage/...` 等 13 个后台页路径（已迁到 pages-admin）
  3. Jest 未在 1s 后退出（异步 open handles，疑似 setTimeout 未清理）

---

## 3-5 可证伪假设

### H1: 页面模块未在 onLoad 中调用 `createPerformanceHelpers(this)`，导致方法直接调用 `this.applyState` 崩溃
- **Falsifiable**: 打开 booking-manage-detail.js 和 booking-detail.js 的 onLoad，检查是否存在 `this.perf = createPerformanceHelpers(this)` + `this.applyState = this.perf.applyState` 赋值。
- **Observation Point**: 两文件的 onLoad 函数体；L1027 / L1095 调用 applyState 的位置是否在 onLoad 之后才有可能被调用。

### H2: subagent 只改了 25 个测试文件，但有 ~58 处引用后台页路径的代码（含 consumerIconStyle / unsavedChanges / managementSearchStyle / pageAsyncLifecycle 等）被遗漏
- **Falsifiable**: grep 输出 58 行，统计涉及多少个 test 文件；逐个路径批量替换 `pages/` → `pages-admin/`（仅 13 个后台页前缀）。
- **Observation Point**: 替换后 Jest ENOENT 报错从 N → 0。

### H3: Jest open handles = performance.js 中 applyState 用的 setTimeout(flush,0) 未被 dispose 清理（测试没有调用 onUnload）
- **Falsifiable**: 在每个测试 teardown 或 performance.js 内部，对 Node.js 环境（Jest）检测 `typeof window !== undefined` 或使用 `jest.useFakeTimers()` 可消除。
- **Observation Point**: 加 `--detectOpenHandles` 跑出具体未关闭句柄位置；或在 Page() 导出末尾 dispose。

### H4: bookingHandover 相关测试并未调用 onLoad 就直接调用实例方法（handleSubmitHandover / handleConfirmHandover）
- **Falsifiable**: 打开 bookingHandover.page.test.js（第 51 / 66 / 73 行）看测试脚手架是否在 `new Page()` 后手动 `onLoad.call(page, {...})`。
- **Observation Point**: 若未调用，要么修复测试脚手架，要么给 applyState 做 fallback（applyState = applyState || setData）。

### H5: booking-manage-detail.js 的 applyState 赋值被后续逻辑覆盖 / 或 onLoad 中 `requirePagePermission` 抛错提前 return，导致 createPerformanceHelpers 未跑
- **Falsifiable**: 审查 onLoad 中 createPerformanceHelpers 与 requirePagePermission 的顺序；若 require 在前面且 throw，则 perf 没初始化。
- **Observation Point**: onLoad 中两行顺序 + try/catch 包裹情况。

---

## 证据日志（Evidence Table）

| # | 时间 | 位置 | 观测 | H 确认/驳回 |
|---|---|---|---|---|
| E1 | 2026-09-04 Step1 | Jest 全量输出 | 20 suites / 111 tests 失败；分 3 类：applyState 不存在(1) / ENOENT 路径(2) / open handles(3) | 所有假设待验证 |
| E2 | 2026-09-04 Step1 | Grep `__tests__/pages/(13 admin pages)` | 58 行路径引用分布在至少 15+ 测试文件（consumerIconStyle ×20, pageAsyncLifecycle ×6, 各 xxx.page.test ×13）| H2 待批量修复 |
| E3 | 待办 | booking-manage-detail.js onLoad | — 验证 H1/H5 | — |
| E4 | 待办 | booking-detail.js onLoad | — 验证 H1/H5 | — |
| E5 | 待办 | bookingHandover.page.test.js 脚手架 | — 验证 H4 | — |
| E6 | 待办 | performance.js Node 环境兼容 | — 验证 H3 | — |

---

## 当前步骤（Workflow Stage）
- **Stage 2/11**: 假设已列举，待插桩/静态审查确认假设后进入 Fix
