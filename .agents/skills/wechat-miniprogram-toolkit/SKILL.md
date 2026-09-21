---
name: wechat-miniprogram-toolkit
description: >-
  微信小程序高性能架构与工程化全套工具库。适用于在开发、重构或调试微信原生小程序时，
  快速应用高并发状态批处理(applyState)、两级LRU与SWR图片零闪烁缓存、原生交互生命周期安全守卫(pageNativeAction)、
  以及无界面全页面交互点击自动化仿真(Headless Simulation)等成熟模式。
---

# WeChat Mini-Program Architecture & Testing Toolkit

本项目沉淀自微信小程序真实生产架构（2826CarPlay 极境车库），提供高频状态调度、两级缓存、跨页面交互安全与无界面自动化回归测试全套解决方案。

---

## 核心能力与适用场景

当遇到以下开发、性能调优或缺陷排查场景时，请查阅对应指南与参考代码：

| 场景分类 | 典型问题 / 需求 | 解决方案与指南 | 模板代码 |
| :--- | :--- | :--- | :--- |
| **状态调度与时序安全** | 频繁调用 `setData` 界面卡顿；或批处理更新后立即请求接口读取到旧数据（Timing Bug） | [State and Lifecycle Guide](./references/state_and_lifecycle.md) | [performance.js](./examples/performance.js) |
| **图片渲染与 SWR 预载** | 列表跳详情骨架屏白屏闪烁；网络图片重复下载；断网或微信回收缓存导致图片死链 | [Image Cache & SWR Guide](./references/image_cache_swr.md) | [imageCache.js](./examples/imageCache.js) |
| **原生动作切页防穿透** | 用户快速返回或切后台时，异步拨号/弹窗/相册回调导致在错误页面弹窗或内存报错 | [Native Action Guard Guide](./references/native_action_guard.md) | [pageNativeAction.js](./examples/pageNativeAction.js) |
| **无头全链路自动化回归** | 无需微信开发者工具 GUI，在纯 Node.js / CI 中秒级模拟全页面/全组件点击交互与逻辑断言 | [Headless Simulation QA](./references/headless_simulation_qa.md) | [simulateClickSuite.js](./examples/simulateClickSuite.js) |

---

## 快速接入流程 (Standard Integration Workflow)

### 1. 页面级高性能状态助手接入

在页面脚本（如 `pages/example/example.js`）中：

```javascript
const { createPerformanceHelpers } = require("../../shared/performance")
const { activatePageNativeActions, cancelPageNativeActions } = require("../../shared/pageNativeAction")

Page({
  data: {
    keyword: "",
    list: []
  },

  onLoad(options) {
    // 激活原生交互安全守卫
    activatePageNativeActions(this)

    // 初始化性能与防抖助手
    const perf = createPerformanceHelpers(this)
    this._perf = perf
    this.applyState = perf.applyState
    this.flushStateNow = perf.flushStateNow

    // 创建自动绑定的防抖函数（页面卸载时自动回收）
    this._debouncedSearch = perf.debounce((keyword) => {
      this.doSearch(keyword)
    }, 250)
  },

  handleInput(e) {
    const keyword = e.detail.value
    // applyState 会立即同步更新 this.data.keyword，并排期触发渲染层的 setData
    this.applyState({ keyword })
    this._debouncedSearch(keyword)
  },

  onUnload() {
    // 安全取消所有原生动作回调
    cancelPageNativeActions(this)

    // 释放所有防抖定时器与批量渲染定时器
    if (this._perf && typeof this._perf.dispose === "function") {
      this._perf.dispose()
      this._perf = null
    }
  }
})
```

---

## 避坑法则（Checklist）

1. **必须内存同步更新**：批量更新函数绝不能仅在 `wx.nextTick` 回调里修改数据，必须同步修改 `context.data`，否则紧随其后的函数读取全为旧值。
2. **搜索输入框必配双事件**：`<input confirm-type="search">` 必须在 WXML 绑定 `bindinput` 与 `bindconfirm`，在 JS 中同时提供实时防抖与回车立即触发。
3. **原生弹窗必须验栈**：在 `wx.makePhoneCall`、`wx.showModal` 或文件上传成功回调中，务必使用 `isPageNativeActionActive(this, action)` 保护，若用户已离开该页则静默退出。
