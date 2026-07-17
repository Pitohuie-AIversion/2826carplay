# PROJECT_CONSTRAINTS.md

## 1. 项目边界约束

本项目第一阶段只做汽车展示与预约咨询 MVP。

第一阶段必须完成：

- 首页车辆展示
- 分类筛选
- 车辆详情页
- 预约表单
- 我的页面静态入口
- 客服、电话、分享入口
- 本地 mock 数据驱动页面

第一阶段禁止开发：

- 在线支付
- 押金支付
- 身份证认证
- 驾驶证认证
- 电子合同
- 自动排期
- 真实订单系统
- 优惠券
- 会员等级
- 积分系统
- 复杂后台管理系统
- 实时库存锁定
- 地图定位
- 导航功能
- 车辆保险计算
- 违章处理
- 发票系统

如需新增上述功能，必须等待用户明确确认。

---

## 2. 技术选型约束

本项目使用微信小程序原生开发。

允许使用：

- WXML
- WXSS
- JavaScript
- JSON
- 微信小程序原生 API

禁止使用：

- Vue
- React
- Taro
- UniApp
- TypeScript
- Vant Weapp
- uView
- Tailwind
- Sass / Less
- Webpack 自定义构建
- 复杂状态管理库

第一阶段不接入：

- 云开发
- 自建服务器
- MySQL
- MongoDB
- Redis
- 对象存储
- 第三方登录系统
- 第三方支付系统

所有数据先使用本地 mock data。

---

## 3. 文件结构约束

项目结构必须保持清晰、简单。

推荐结构：

```text
miniprogram/
  app.js
  app.json
  app.wxss

  pages/
    garage/
    car-detail/
    booking/
    mine/

  components/
    car-card/
    category-tabs/
    bottom-action-bar/

  data/
    cars.js
    categories.js

  assets/
    cars/
    icons/

  utils/
    format.js
```

禁止：

- 在一个文件中堆积所有逻辑
- 在 WXML 中手写大量重复车辆卡片
- 在页面中直接写死大量车辆信息
- 创建无关目录
- 创建无关页面
- 创建空文件占位但不使用
- 随意修改已有文件命名

---

## 4. 页面路由约束

页面路径固定如下：

```text
首页：pages/garage/garage
车辆详情页：pages/car-detail/car-detail
预约页：pages/booking/booking
我的页面：pages/mine/mine
```

车辆详情页跳转必须携带：

```text
carId
```

例如：

```js
wx.navigateTo({
  url: `/pages/car-detail/car-detail?carId=${car.id}`
})
```

预约页跳转必须携带：

```text
carId
```

例如：

```js
wx.navigateTo({
  url: `/pages/booking/booking?carId=${car.id}`
})
```

禁止使用车辆名称作为唯一查询条件。  
必须使用 `id` 作为车辆唯一标识。

---

## 5. 数据约束

车辆数据必须来自 `data/cars.js`。

分类数据必须来自 `data/categories.js`。

车辆数据结构必须统一，不允许不同车辆使用不同字段。

车辆 id 必须唯一。

车辆状态只允许：

```text
available
rented
maintenance
reserved
```

对应中文显示：

```text
available    在库
rented       出库
maintenance 维护中
reserved     已预约
```

车辆分类只允许：

```text
luxury_sedan
city_suv
offroad
supercar
commuter_ev
pickup
```

禁止：

- 页面内直接写死车辆状态
- 页面内直接写死价格
- 页面内直接写死标签
- 用数组下标作为车辆 id
- 用车辆名称作为唯一 id
- mock 数据超过 10 辆车

---

## 6. UI 风格约束

整体视觉必须接近参考截图。

核心风格：

- 深色背景
- 车库氛围
- 大图车辆卡片
- 高对比白色文字
- 蓝色状态标签
- 细边框
- 轻微阴影
- 横向车辆主图
- 底部固定操作栏

首页禁止做成：

- 普通白底商城页面
- 新闻列表页面
- 普通租车平台页面
- 卡通风格页面
- 过度渐变页面
- 复杂动画页面

推荐颜色：

```css
page {
  background: #101010;
}

.card {
  background: #181818;
  border: 1px solid #3a3a3a;
}

.text-main {
  color: #ffffff;
}

.text-sub {
  color: #b8b8b8;
}

.status-available {
  background: #2f80ed;
}

.status-rented {
  background: #8a8a8a;
}

.status-maintenance {
  background: #f2994a;
}

.status-reserved {
  background: #9b51e0;
}
```

---

## 7. 车辆卡片约束

车辆卡片必须包含：

- 车辆封面图
- 车辆昵称
- 车辆状态
- 车辆名称
- 车辆标签
- 今日价格

卡片布局要求：

```text
左上角：车辆昵称
右上角：车辆状态
底部左侧：车辆名称 + 标签
底部右侧：价格
```

车辆图片必须使用：

```text
mode="aspectFill"
```

禁止：

- 图片被压缩变形
- 车辆卡片高度不统一
- 价格和车型位置混乱
- 状态标签颜色不区分
- 卡片点击区域过小

---

## 8. 组件约束

车辆卡片必须组件化：

```text
components/car-card/
```

分类导航建议组件化：

```text
components/category-tabs/
```

底部操作栏建议组件化：

```text
components/bottom-action-bar/
```

组件必须通过 properties 接收数据。

禁止组件直接 import 全部车辆数据。  
组件只负责展示和触发事件，不负责业务筛选。

---

## 9. 业务逻辑约束

首页负责：

- 加载车辆数据
- 加载分类数据
- 当前分类状态
- 分类筛选
- 页面跳转

车辆卡片组件负责：

- 展示单辆车
- 点击后触发事件

详情页负责：

- 接收 carId
- 查找车辆
- 展示车辆详情
- 跳转预约页
- 电话咨询

预约页负责：

- 接收 carId
- 展示车辆名称
- 表单输入
- 基础校验
- 本地提交提示

禁止：

- 在组件中写复杂业务逻辑
- 在详情页修改车辆状态
- 在预约页真实创建订单
- 在首页处理预约表单逻辑

---

## 10. 表单约束

预约表单字段：

- 姓名
- 手机号
- 取车日期
- 还车日期
- 城市
- 备注

基础校验：

- 姓名不能为空
- 手机号不能为空
- 手机号长度必须为 11 位
- 取车日期不能为空
- 还车日期不能为空
- 还车日期不能早于取车日期

第一阶段提交后只显示：

```text
预约信息已提交，客服将尽快联系您
```

禁止：

- 真实提交服务器
- 发送短信验证码
- 保存身份证
- 保存驾驶证
- 收集不必要个人信息

---

## 11. 微信能力使用约束

允许使用：

```js
wx.navigateTo
wx.switchTab
wx.showToast
wx.makePhoneCall
wx.showModal
wx.previewImage
```

分享功能使用小程序原生分享能力。

客服功能优先使用微信客服按钮能力。

电话功能使用：

```js
wx.makePhoneCall
```

禁止：

- 自定义伪造支付流程
- 自定义伪造登录状态
- 自动获取用户手机号
- 自动获取用户精确位置
- 未经用户确认收集隐私信息

---

## 12. 性能约束

首页车辆数量第一阶段控制在 4-10 辆。

图片使用本地路径或压缩后的静态图片。

图片建议：

```text
首页封面图：宽度 750px 左右
详情页图片：宽度 1000px 左右
格式：jpg / webp
单张图片尽量小于 500KB
```

禁止：

- 首页一次性加载大量高清大图
- 使用超大 PNG 图片
- 使用 base64 图片
- 频繁 setData 大对象
- 在页面 onShow 中重复加载无变化数据

---

## 13. 兼容性约束

页面必须适配：

- iPhone 常见尺寸
- Android 常见尺寸
- 刘海屏
- 底部安全区域

底部固定栏必须考虑：

```css
padding-bottom: env(safe-area-inset-bottom);
```

禁止：

- 重要按钮贴近屏幕底部
- 横向溢出
- 文本被遮挡
- 图片超出卡片
- 状态标签被裁切

---

## 14. 开发流程约束

Agent 每次执行任务前必须：

1. 阅读 `agent.md`
2. 阅读 `TODOlist.md`
3. 阅读 `PROJECT_CONSTRAINTS.md`
4. 确认当前 Phase
5. 只执行当前 Phase

Agent 每次完成后必须输出：

```text
完成阶段：
修改文件：
新增文件：
主要改动：
测试方式：
已知问题：
下一步建议：
```

禁止：

- 不说明改了哪些文件
- 一次性跨多个 Phase
- 私自新增功能
- 私自更换技术栈
- 私自删除已有代码
- 输出大量无关解释

---

## 15. 验收约束

第一版 MVP 最终必须满足：

- 微信开发者工具无编译错误
- 首页正常显示
- 分类筛选正常
- 车辆卡片正常显示
- 点击车辆进入正确详情页
- 详情页车辆信息正确
- 点击立即预约进入预约页
- 预约表单基础校验正常
- 我的页面正常显示
- 底部操作栏正常显示
- 页面风格接近参考截图
- 无支付功能
- 无真实订单功能
- 无无关依赖
- 无无关页面
- 无大量 console.log

---

## 16. 最高优先级规则

当需求冲突时，优先级如下：

```text
用户最新明确要求
> PROJECT_CONSTRAINTS.md
> TODOlist.md
> agent.md
> README.md
> Agent 自己的判断
```

Agent 不允许以“优化体验”为理由突破项目约束。
