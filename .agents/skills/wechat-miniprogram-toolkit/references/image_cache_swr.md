# 微信小程序图片双层缓存与 SWR 预载指南 (Image Cache & SWR)

## 1. 核心问题与痛点

小程序图片加载常伴随严重的用户体验问题：
1. **白屏闪烁**：从列表页点击卡片进入详情页时，页面常常要等云函数返回后重新拉取大图，导致页面先显示骨架屏或 Loading 遮罩数秒，出现“闪白”或跳动。
2. **重复下载与网络浪费**：微信原生的 `<image>` 组件缓存机制受系统清理影响频繁失效，同一辆车、同一个商品在列表、详情、海报、收藏中被反复下载。
3. **微信本地临时文件被回收后的死链风险**：若将临时文件路径（`wxfile://`）存入 Storage，当微信 OS 清理缓存后，这些路径将彻底变成不可读死链，导致图片完全空白。

---

## 2. 两级缓存架构（LRU Memory + Local Disk）

极境车库沉淀的图片缓存采用两级防线：

```text
[ 页面请求图片 ]
       │
       ▼
1. 内存级 LRU 缓存 (MAX: 80 项) ───[命中]───> 0ms 瞬间返回已确认状态
       │
      [未命中]
       │
       ▼
2. 本地持久磁盘缓存 (wx.env.USER_DATA_PATH) ───[命中且文件存在]───> 瞬时读取本地磁盘路径
       │
      [未命中或文件已被系统清理]
       │
       ▼
3. 网络队列排队下载 (并发上限: 3) ───> 下载成功 ───> 存入磁盘 ───> 写入内存 LRU ───> 呈现
```

### 关键防踩坑设计：
- **文件存活自愈校验**：在读取磁盘缓存返回给页面前，调用 `fs.accessSync()` 验证文件是否仍真实存在。如果已被系统回收，自动将该死链从 Storage 映射表中剔除，并安全降级为原始网络 URL，绝不让页面显示红叉或空白！
- **并发控制与去重**：限制最大并发下载为 3，若同一种 URL 正在下载中，后续请求挂入 `pendingDownloads` 监听同一个 Promise，绝不发起重复下载。

---

## 3. SWR (Stale-While-Revalidate) 零闪烁跨页面传递

从列表跳往详情页的标准体验规范：

### Step 1: 列表页点击时透传已渲染数据
```javascript
// pages/garage/garage.js
handleCarTap(e) {
  const car = e.currentTarget.dataset.car
  // 将用户在列表卡片上已经看到的数据暂存到全局或通过路由携带
  const app = getApp()
  if (app && app.globalData) {
    app.globalData.previewCar = car
  }
  wx.navigateTo({
    url: `/pages/car-detail/car-detail?id=${car.id}`
  })
}
```

### Step 2: 详情页 onLoad 同步挂载预载状态
```javascript
// pages/car-detail/car-detail.js
onLoad(options) {
  const app = getApp()
  const preview = (app && app.globalData && app.globalData.previewCar) || null
  
  if (preview && preview.id === options.id) {
    // 关键：直接将封面图的 loaded 状态标为 true，初始化 loading: false
    this.setData({
      car: preview,
      initialLoading: false,
      "imageState.coverLoaded": true
    })
  } else {
    this.setData({ initialLoading: true })
  }

  // 随后异步向云端拉取最新全量数据（SWR 差量同步）
  this.loadDetail(options.id)
}
```

---

## 4. 落地检查清单 (Checklist)

- [ ] 核心展示大图引入 `preloadImages([url])` 进行空闲预热。
- [ ] 跨页面跳转携带 Preview 简要对象，实现详情页瞬时上屏。
- [ ] 本地磁盘文件保存至 `wx.env.USER_DATA_PATH/image_cache/`，并在 `onShow` 时调用 `clearExpiredCache()` 按 LRU 清理过期文件。
