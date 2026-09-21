# 微信小程序状态调度与生命周期管理指南 (State and Lifecycle)

## 1. 核心问题与痛点

在微信小程序中，`this.setData()` 具有双重语义：
1. **更新逻辑层内存数据**（`this.data`）。
2. **通过 Native Bridge 将序列化后的数据跨线程传输给渲染层**（Webview/Skyline）。

### 痛点 A：高频 setData 引发渲染阻塞与掉帧
快速连续调用 `setData`（如滑动、倒计时、打字输入）会导致通信通道积压，真机明显掉帧甚至发烫。

### 痛点 B：仅做异步批量更新导致的“时序幽灵”（Timing Bug）
很多开发者为了解决痛点 A，将 `patch` 缓存在一个对象中，利用 `wx.nextTick` 或 `setTimeout(..., 16)` 批量合并调用 `setData`。
但若**未在当前 tick 同步修改 `this.data` 内存**，会出现极隐蔽的 Bug：
```javascript
// 错误示范：
handleTabClick(status) {
  this.applyState({ currentStatus: status }) // 排队进 nextTick，但当前 this.data.currentStatus 仍是旧值
  this.fetchList() // 同步执行！
}

fetchList() {
  const status = this.data.currentStatus // 致命错误：读到了旧状态！
  wx.cloud.callFunction({ data: { status } }) // 向服务器发送了错误的查询请求！
}
```

---

## 2. 解决方案：同步内存修改 + 异步合并渲染

### 核心实现原理：
```javascript
function applyState(patch) {
  if (destroyed || !patch || typeof patch !== "object") return

  // 1. 核心第一步：立即同步把新字段应用到 context.data 内存对象中
  applyPatchToTarget(context.data, patch)

  // 2. 将补丁深度合并到待通知渲染层的 pendingPatch 缓冲池中
  pendingPatch = deepMergePatch(pendingPatch, patch)

  // 3. 调度下一次渲染帧（nextTick 或 16ms）
  if (flushTimer === null) {
    if (IN_WX_ENV) {
      wx.nextTick(flushPending)
    } else {
      flushTimer = setTimeout(flushPending, APPLY_STATE_FLUSH_MS)
    }
  }
}
```

通过这一改动：
- 逻辑代码在 `applyState` 后的任意地方读取 `this.data`，立即能拿到最新变更；
- 渲染层在当前 JS 执行完成后的渲染帧一次性接收合并后的数据，完全消除冗余通信。

---

## 3. 防抖定时器的自动生命周期托管

### 痛点：
防抖函数（`debounce`）常用于搜索框输入。如果用户输入后迅速点击返回按钮离开页面，未执行的防抖定时器依然会在后台触发，尝试对已卸载的页面调用 `setData` 或发起网络请求，造成内存泄露或报错。

### 规范：
使用 `createPerformanceHelpers` 派生的 `debounce`：
1. 内部自动维护 `debounceHandles` 注册表；
2. 在页面的 `onUnload` 钩子中集中调用 `perf.dispose()`，一次性清理所有挂起的定时器；
3. 支持通过 `timer.unref()`（在 Node.js 单测环境中）防止 Jest 测试进程无法正常退出。

---

## 4. 落地检查清单 (Checklist)

- [ ] 页面在 `onLoad` 中初始化 `createPerformanceHelpers(this)` 并绑定 `this.applyState`。
- [ ] 页面在 `onUnload` 中执行 `this._perf.dispose()`。
- [ ] 搜索框 `<input>` 同时声明了 `bindinput` 与 `bindconfirm`，回车时调用 `_debouncedFilterSearch.cancel()` 并立即触发搜索。
- [ ] 复杂筛选方法支持显式传参（如 `fetchList({ status: "active" })`），减少对内部状态读取的绝对耦合。
