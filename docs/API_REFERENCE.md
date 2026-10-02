# 共享架构库 API 规范与参考手册 (shared/ API Reference)

本项目所有跨页面与前后端共享逻辑均收敛于 `shared/` 目录，并通过 [shared/index.js](file:///g:/Autosave/2826carplay/shared/index.js) 统一导出分层命名空间与快捷方法。

---

## 目录与模块索引

```text
shared/
├── index.js                  # 统一门面导出 (Barrel Facade)
├── pageController.js         # 声明式页面控制器工厂 (definePage, createPageController)
├── cloudClient.js            # 标准化云函数通信客户端 (callCloud)
├── dateUtils.js              # 日期、租期计算与时间重叠校验工具集
├── vehicleLabels.js          # 车辆展示枚举、状态机与选择器选项
├── bookingStatus.js          # 预约状态机、调度优先级与协调流转字典
├── privacy.js                # 隐私权利申请与合规状态流转领域模型
├── performance.js            # 内存同步优先的 applyState 状态调度器
├── imageCache.js             # 两级 LRU + SWR 零闪烁图片预加载缓存
├── pageNativeAction.js       # 微信系统级动作生命周期防穿透守卫
├── networkStatus.js          # 弱网监听与断网重连自愈
└── uiFeedback.js             # 界面轻提示与 Toast 字符截断防溢出
```

---

## 1. 页面控制器与生命周期 (pageController.js)

### `definePage(pageOptions)`
高阶工厂函数，自动为页面注入页面控制器、内存同步优先的 `applyState`，并在 `onUnload` 时自动清理所有挂载资源。

```javascript
const { definePage, callCloud, calculateRentalDays } = require("../../shared")

definePage({
  data: {
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    rentalDays: 3,
    list: []
  },

  onLoad(options) {
    // this.controller 与 this.applyState 已自动就绪
    this.fetchData()
  },

  handleDateChange(e) {
    const { startDate, endDate } = e.detail
    const rentalDays = calculateRentalDays(startDate, endDate)
    // 内存数据立即同步，并在 16ms 内合并排期渲染
    this.applyState({ startDate, endDate, rentalDays })
  },

  async fetchData() {
    const res = await callCloud("vehicleList", {}, { pageContext: this })
    if (res.ok) {
      this.applyState({ list: res.data })
    }
  }
  // onUnload 自动触发 controller.dispose()，无需手动销毁定时器
})
```

### `createPageController(pageInstance, options)`
用于已有或自定义页面手动初始化生命周期控制器。

- **`controller.applyState(patch, callback)`**：内存同步优先的状态批处理更新。
- **`controller.flushStateNow()`**：立即强制清空当前待排期的状态更新并触发渲染。
- **`controller.beginAction(options)`**：派发原生动作代币（支持 `exclusiveKey` 排他模式）。
- **`controller.isActionActive(actionToken)`**：校验当前动作代币及页面是否依然有效活跃。
- **`controller.dispose()`**：主动销毁所有挂载的防抖器、定时器与监听器。

---

## 2. 云函数统一调用客户端 (cloudClient.js)

### `callCloud(name, data, options)`
为微信 `wx.cloud.callFunction` 提供统一的超时中断保护、页面卸载守卫以及结构化错误码响应。

- **入参**：
  - `name` *(string)*: 云函数名称。
  - `data` *(object)*: 业务透传参数字典。
  - `options` *(object)*:
    - `pageContext` *(Page)*: 当前页面实例。若页面已卸载，回调将自动静默拦截，严防跨页污染。
    - `timeoutMs` *(number)*: 超时阈值，默认 `15000` ms。超时返回 `CLOUD_TIMEOUT` 错误码。
    - `showErrorToast` *(boolean)*: 出错时是否自动弹出微信 `wx.showToast`，默认 `false`。
    - `toastDurationMs` *(number)*: 错误提示停留时间，默认 `2000` ms。

- **返回格式**：
  - 成功：`{ ok: true, data: ..., raw: ... }`
  - 失败：`{ ok: false, code: "CLOUD_TIMEOUT" | "CLOUD_ERROR" | "...", message: "...", raw: ... }`

```javascript
const { callCloud } = require("../../shared/cloudClient")

const res = await callCloud("bookingCreate", formPayload, {
  pageContext: this,
  timeoutMs: 12000,
  showErrorToast: true
})

if (res.ok) {
  wx.navigateTo({ url: `/pages/booking-detail/booking-detail?id=${res.data.id}` })
}
```

---

## 3. 日期与租期业务计算 (dateUtils.js)

集中消除跨页面和跨模块的租期硬编码计算，确保全站天数基准一致。

| 函数名 | 入参 | 返回值 | 说明 |
| :--- | :--- | :--- | :--- |
| `isValidDateFormat(value)` | `string` | `boolean` | 校验是否为合法的 `YYYY-MM-DD` 格式并校验闰年有效性。 |
| `isDateRangeValid(startDate, endDate)` | `string, string` | `boolean` | 校验起止日期格式且满足 `startDate <= endDate`。 |
| `calculateRentalDays(startDate, endDate)` | `string, string` | `number` | **包含首尾日**的租赁天数（如 10-01 至 10-01 为 1 天；10-01 至 10-03 为 3 天）。倒置或非法返回 0。 |
| `formatDateSpan(startDate, endDate, options)` | `string, string, object` | `string` | 输出 "3 天"；若 `withNights: true` 则输出 "3 天 2 晚"。 |
| `addDays(dateStr, days)` | `string, number` | `string` | 跨月份/跨年份安全加减天数，返回 `YYYY-MM-DD`。 |
| `isDateOverlap(startA, endA, startB, endB)` | `string * 4` | `boolean` | 判断两个闭区间日期是否发生时间冲突/重叠。 |
| `isDateInRange(targetDate, startDate, endDate)` | `string * 3` | `boolean` | 判断指定日期是否位于合法起止闭区间内。 |
| `compareDates(dateA, dateB)` | `string, string` | `number` | 比较两日期大小（`-1` / `0` / `1`）。 |

---

## 4. 车辆展示枚举与字典 (vehicleLabels.js)

统一管理用户端与管理端关于车辆分类、动力模式、变速箱与状态的展示与选择器。

```javascript
const {
  VEHICLE_TYPE_LABEL_MAP,
  STATUS_OPTIONS,
  TRANSMISSION_LABEL_MAP,
  FUEL_TYPE_LABEL_MAP,
  CATEGORY_LABEL_MAP,
  CLIENT_VEHICLE_STATUS_TEXT_MAP,
  CLIENT_VEHICLE_STATUS_CLASS_MAP,
  getClientVehicleStatusText
} = require("../../shared/vehicleLabels")

// 客户端状态文案格式化
const text = getClientVehicleStatusText(car.status, "可预约") // "可预约" | "使用中" | "维护中" | "已预约"
```

- **`CLIENT_VEHICLE_STATUS_TEXT_MAP`**：`idle -> "可预约"`, `available -> "可预约"`, `active -> "使用中"`, `rented -> "使用中"`, `maintenance -> "维护中"`, `reserved -> "已预约"`。
- **`STATUS_OPTIONS`**：管理端通用筛选选项列表（`all`, `active`, `idle`, `maintenance`, `retired`）。

---

## 5. 预约状态与流转模型 (bookingStatus.js)

收敛预约单 8 大状态机、管理端工作台优先级与协调流转。

```javascript
const {
  STATUS_TEXT_MAP,
  STATUS_CLASS_MAP,
  STATUS_OPTIONS,
  WORKBENCH_PRIORITY_OPTIONS,
  COORDINATION_OPTIONS,
  mapStatusText,
  mapPriorityText,
  mapCoordinationText,
  canCancelBooking,
  canEditBooking
} = require("../../shared/bookingStatus")
```

- **`canCancelBooking(status)`**：判断当前预约单状态是否允许用户发起取消（`pending`, `contacted`, `quoted`, `adjustment_requested`, `confirmed` 为 true）。
- **`canEditBooking(status)`**：判断预约单是否允许修改联系信息（仅在 `pending` 与 `contacted` 阶段允许）。
- **`WORKBENCH_PRIORITY_OPTIONS`**：`[{ key: "priority", label: "优先" }, { key: "normal", label: "常规" }, { key: "standby", label: "候补" }]`。

---

## 6. 用户隐私与数据权利 (privacy.js)

收敛个人信息保护法（PIPL）合规要求下的用户数据查询、更正、删除全流程。

```javascript
const {
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  getPrivacyTypeLabel,
  getPrivacyStatusLabel,
  canCancelPrivacyRequest,
  buildRequestJourney
} = require("../../shared/privacy")

// 自动生成时间轴与流程进度样式
const journey = buildRequestJourney(request.status)
// => { journeyStage: 1 | 2 | 3, step1Class: "step-done", step2Class: "step-current", ... }
```

---

## 7. 高并发批处理与渲染优化 (performance.js)

```javascript
const { createPerformanceHelpers } = require("../../shared/performance")

const { applyState, flushStateNow, clearPendingTimer } = createPerformanceHelpers(this)

// 关键机制：先在当前同步 tick 内通过 applyPatchToTarget 修改内存，然后推入 wx.nextTick
applyState({ filter: "luxury_sedan", totalCount: 12 })
console.log(this.data.filter) // 立即读取到 "luxury_sedan"！杜绝时序差
```

---

## 8. 两级 LRU + SWR 图片缓存 (imageCache.js)

实现网络图片首屏零白屏与毫秒级即时呈现。

```javascript
const { preloadImages, clearExpiredCache } = require("../../shared/imageCache")

// 批量预加载车辆封面，存入内存 LRU 并写入持久缓存
preloadImages([car.coverUrl, car.bannerUrl])

// 适时清理过期图片缓存
clearExpiredCache()
```

---

## 9. 原生动作生命周期防穿透 (pageNativeAction.js)

用于微信系统级异步交互（`wx.makePhoneCall`、`wx.chooseMedia`、`wx.showActionSheet`）。

```javascript
const {
  activatePageNativeActions,
  beginPageNativeAction,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

// 1. 注册保护机制
activatePageNativeActions(this)

// 2. 发起动作
const actionToken = beginPageNativeAction(this, { exclusiveKey: "callAdvisor" })

wx.makePhoneCall({
  phoneNumber: "400-xxx-xxxx",
  complete: () => {
    // 3. 校验页面与动作有效性，若用户已切走页面则自动静默退出，防止后台脏写入
    if (!isPageNativeActionActive(this, actionToken)) return
    this.setData({ calling: false })
  }
})
```
