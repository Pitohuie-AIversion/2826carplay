# 微信小程序原生动作生命周期安全守卫指南 (Native Action Guard)

## 1. 核心问题与痛点

小程序中大量依赖微信系统级原生能力：
- 拨打电话：`wx.makePhoneCall()`
- 底部操作菜单：`wx.showActionSheet()`
- 模态弹窗确认：`wx.showModal()`
- 拍照/选图：`wx.chooseMedia()` / `wx.chooseImage()`
- 转发分享与客服回跳

### 常见缺陷场景：
1. **用户快速返回或切后台**：用户点击拨打客服，系统弹出原生拨号界面；此时用户点击返回键回到上一页。数秒后拨号完成或用户取消，原生异步回调返回，在已离开的页面上下文执行 `this.setData()`，引发框架警告甚至报红。
2. **跨页面弹窗穿透**：在前一个页面点击了耗时确认弹窗，用户快速返回后，弹窗突然在当前无关页面弹出，严重破坏业务流程。
3. **并发重复点击**：连击两次上传照片，触发了两个并行的原生 Action，导致回调乱序互相覆盖状态。

---

## 2. 解决方案：`pageNativeAction` 守卫模式

### 设计核心机制：
1. **生命周期序列号 (`lifecycleSerial`)**：页面每次初始化时递增，卸载（`onUnload`）时注销。
2. **互斥行为序列号 (`exclusiveSerial`)**：对同一个排他动作（如拨号），只允许最后一次点击生效。
3. **栈顶活跃性检查 (`isPageCurrent`)**：检查 `getCurrentPages()` 数组最后一项是否仍然是发起动作的页面实例。

---

## 3. 标准接入示范

### Step 1: 页面生命周期挂载
```javascript
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

Page({
  onLoad() {
    // 激活原生动作守卫
    activatePageNativeActions(this)
  },

  handleCallService() {
    // 1. 开启一个需要当前页面处于栈顶的独占动作
    const action = beginPageNativeAction(this, {
      requireCurrent: true,
      exclusiveKey: "phoneCall"
    })

    wx.makePhoneCall({
      phoneNumber: "400-888-2826",
      fail: (error) => {
        // 2. 关键：检查用户是否仍在当前页面
        if (!isPageNativeActionActive(this, action)) {
          return // 用户已切走或页面已卸载，静默退出
        }

        const msg = error && (error.errMsg || error.message)
        if (msg && String(msg).includes("cancel")) {
          return // 用户主动取消拨打，无需报错
        }

        // 依然在当前页面，安全弹出错误提示
        wx.showModal({
          title: "拨号失败",
          content: "请手动联系客服人员",
          showCancel: false
        })
      }
    })
  },

  onUnload() {
    // 3. 卸载时彻底取消所有挂起动作
    cancelPageNativeActions(this)
  }
})
```

---

## 4. 落地检查清单 (Checklist)

- [ ] 页面在 `onLoad` 中执行 `activatePageNativeActions(this)`。
- [ ] 页面在 `onUnload` 中执行 `cancelPageNativeActions(this)`。
- [ ] 所有调用原生系统级弹窗、相册、扫码、拨号的异步回调，在执行逻辑前调用 `isPageNativeActionActive` 守护。
