# agent.md

## 项目名称

极境车库微信小程序

## 项目目标

开发一个用于汽车展示、车辆筛选、车辆详情查看、预约咨询的微信小程序。第一阶段目标是完成一个高质感车辆展示 MVP，不做复杂交易系统。

小程序主要参考当前设计风格：

- 黑色车库背景
- 大图车辆卡片
- 车辆昵称大字展示
- 车辆状态标签：在库 / 出库 / 维护中
- 价格展示：今日 ￥599 / 24小时
- 底部固定入口：客服 / 电话 / 分享 / 我的

## 技术栈约束

本项目使用微信小程序原生开发方式：

- WXML
- WXSS
- JavaScript
- JSON 配置文件

第一阶段不要引入：

- Vue / React / Taro / UniApp
- TypeScript
- 第三方 UI 框架
- 在线支付
- 复杂会员系统
- 地图 SDK
- 自建后端

第一阶段数据优先使用本地 mock data。后续再接入微信云开发数据库。

## 开发原则

1. 每次修改前，先阅读现有文件结构。
2. 不允许删除已有功能，除非 TODO 明确要求。
3. 不允许一次性重构整个项目。
4. 每次只完成 TODOlist 中当前阶段的任务。
5. 所有页面必须能在微信开发者工具中正常编译。
6. 不允许留下无用 console.log。
7. 不允许生成大量无关说明文件。
8. 不允许创建和当前任务无关的页面、组件或工具函数。
9. 样式优先保证移动端微信小程序显示效果。
10. 图片路径使用本地 mock 路径，真实图片后续替换。

## 页面结构

推荐页面结构如下：

```text
pages/
  garage/
    garage.wxml
    garage.wxss
    garage.js
    garage.json

  car-detail/
    car-detail.wxml
    car-detail.wxss
    car-detail.js
    car-detail.json

  booking/
    booking.wxml
    booking.wxss
    booking.js
    booking.json

  mine/
    mine.wxml
    mine.wxss
    mine.js
    mine.json
```

推荐组件结构如下：

```text
components/
  car-card/
    car-card.wxml
    car-card.wxss
    car-card.js
    car-card.json

  category-tabs/
    category-tabs.wxml
    category-tabs.wxss
    category-tabs.js
    category-tabs.json

  bottom-action-bar/
    bottom-action-bar.wxml
    bottom-action-bar.wxss
    bottom-action-bar.js
    bottom-action-bar.json
```

推荐数据结构如下：

```text
data/
  cars.js
  categories.js
```

## 页面功能要求

### 1. garage 首页

首页是核心页面，需要完成：

- 顶部标题：极境车库
- 分类导航：
  - 迷你乐趣
  - 奢享旗舰
  - 性能闪电
  - 经典燃油
- 车辆列表
- 点击分类后筛选车辆
- 点击车辆卡片进入详情页
- 底部固定操作栏：
  - 客服
  - 电话
  - 分享
  - 我的

### 2. car-detail 车辆详情页

详情页需要展示：

- 车辆图片轮播
- 车辆名称
- 车辆昵称
- 车辆状态
- 今日价格
- 车辆标签
- 车辆基础信息
- 租赁说明
- 底部按钮：
  - 立即预约
  - 电话咨询

### 3. booking 预约页

预约页需要包含：

- 车辆名称
- 姓名输入框
- 手机号输入框
- 取车日期
- 还车日期
- 城市
- 备注
- 提交按钮

第一阶段提交后只做本地提示，不接入真实后台。

### 4. mine 我的页面

第一阶段只需要静态页面：

- 我的预约
- 我的收藏
- 联系客服
- 常见问题
- 平台规则

## 车辆数据模型

车辆数据必须保持统一结构：

```js
{
  id: "car_001",
  name: "MX-5 ND2",
  nickname: "北极星",
  brand: "Mazda",
  category: "mini_fun",
  priceDay: 599,
  priceText: "今日 ￥599 / 24小时",
  status: "available",
  statusText: "在库",
  location: "杭州",
  tags: ["手动挡", "软顶敞篷"],
  transmission: "manual",
  fuelType: "gasoline",
  seats: 2,
  cover: "/assets/cars/mx5_cover.jpg",
  images: [
    "/assets/cars/mx5_01.jpg",
    "/assets/cars/mx5_02.jpg"
  ],
  description: "轻量化双座敞篷跑车，适合城市周边驾驶体验。",
  sort: 1
}
```

车辆状态只允许使用：

```js
available      // 在库
rented         // 出库
maintenance    // 维护中
reserved       // 已预约
```

分类只允许使用：

```js
mini_fun
luxury
performance
classic_fuel
electric
```

## UI 风格约束

整体视觉风格：

- 深色背景
- 高对比文字
- 车库氛围
- 大图卡片
- 边框细线
- 状态标签清晰

推荐颜色：

```css
--bg-main: #101010;
--bg-card: #181818;
--border-card: #3a3a3a;
--text-main: #ffffff;
--text-sub: #b8b8b8;
--blue-main: #2f80ed;
--gray-status: #8a8a8a;
--orange-status: #f2994a;
```

首页车辆卡片比例建议接近 16:9。

车辆图片应使用 `mode="aspectFill"`。

## 代码质量要求

1. 页面逻辑保持简单。
2. 组件 props 命名清晰。
3. CSS 类名使用语义化命名。
4. 避免重复样式。
5. 避免硬编码大量车辆 HTML。
6. 车辆列表必须通过数据循环渲染。
7. 分类必须通过数据循环渲染。
8. 价格、状态、标签必须来自车辆数据。
9. 页面跳转必须携带 carId。
10. 详情页必须根据 carId 查找车辆数据。

## 禁止事项

除非用户明确要求，否则禁止：

- 接入支付
- 接入真实租车合同
- 接入身份证认证
- 接入押金冻结
- 接入真实地图定位
- 接入复杂订单系统
- 创建后台管理系统
- 引入大型依赖
- 改成跨端框架
- 生成无关测试数据超过 10 辆车
- 修改项目名称为其他品牌

## 第一阶段交付标准

完成后必须满足：

1. 首页可以正常显示车辆列表。
2. 分类筛选可以正常工作。
3. 点击车辆可以进入详情页。
4. 详情页信息正确显示。
5. 预约页可以从详情页进入。
6. 预约表单可以填写并提交提示。
7. 底部客服、电话、分享、我的入口存在。
8. 微信开发者工具无编译错误。
9. 页面整体接近参考截图风格。
10. 不包含无关功能。
