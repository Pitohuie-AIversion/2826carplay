# 极境车库小程序开发与行为准则 (WeChat Mini-Program Guardrails)

本项目基于微信原生小程序与腾讯云开发（CloudBase）构建。所有在此代码库进行开发、重构或调试的 Agent 必须严格遵守以下准则：

---

## 1. 状态与事件时序守卫 (State & Timing Guardrails)

- **内存同步优先**：在页面封装或使用状态批处理函数（如 `applyState`）时，**必须在当前执行 tick 内立即同步更新 `this.data`（如调用 `applyPatchToTarget`）**，然后再将更新推入 `wx.nextTick` 或 16ms 定时器排期通知渲染层。绝不允许出现“渲染层延迟批量更新、而内存数据尚未同步更新”的时序差，否则后续紧跟的请求或联动读取 `this.data` 时必将发生 Timing Bug。
- **搜索输入完整闭环**：所有声明了 `confirm-type="search"` 的 `<input>` 搜索框，必须在 WXML 中同时绑定 `bindinput` 与 `bindconfirm="handleSearchConfirm"`，并在 JS 中实现对应的回车立即检索逻辑，取消防抖并立即响应移动端软键盘“搜索”按键。
- **请求参数显式透传**：在处理列表筛选、排序、城市切换或清空重置等交互时，`fetchList(input)` 等数据请求方法应支持并优先接收显式参数字典（如 `{ status, keyword, sortBy, city }`），直接将用户点击产生的最新参数显式透传给请求，消灭由异步排期可能引起的参数状态偏差。

---

## 2. 异步生命周期与资源泄露防范 (Lifecycle & Teardown Guardrails)

- **主动销毁所有定时与事件句柄**：在页面的 `onLoad` 或组件中创建的防抖器 (`debounce`)、延迟定时器 (`setTimeout`)、轮询器 (`setInterval`)、网络重连监听 (`onNetworkReconnect`)，必须在 `onUnload` 中进行完整的 `cancel()` 或 `dispose()`，防止页面卸载后后台工作进程泄漏。
- **原生动作切页保护**：对于微信系统级异步动作（如拨打电话 `wx.makePhoneCall`、拉起操作菜单 `wx.showActionSheet`、图片选择 `wx.chooseMedia`），在异步回调中执行 `this.setData` 或状态联动前，必须通过 `pageNativeAction` 校验当前页面实例是否依然在栈顶且未被卸载（`isPageNativeActionActive`），严防跨页面脏写入或在后台页面触发异常弹窗。

---

## 3. 包体积与性能预算 (Package Budget Guardrails)

- **严守 1.75 MiB 安全水位线**：主包体积硬性上限为 2.0 MiB，开发时严禁将大于 100 KB 的未压缩位图、大体积离线字典或全量测试脚本打入主包。管理端功能统一收敛至 `pages-admin` 独立分包。
- **发布前执行体积校验**：任何涉及页面增删或依赖调整的改动，必须运行 `npm run check:package`，确保主包保持在 1.75 MiB 安全警戒线以下。
- **全量无头点击自动化回归**：提交核心页面修改后，必须运行 `npm run simulate:clicks`（`node scripts/simulateAllComponentClicks.js`），确保全量 26 个页面的 320+ 项用户交互点击断言 100% 通过。
