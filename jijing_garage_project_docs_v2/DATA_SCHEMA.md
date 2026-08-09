# DATA_SCHEMA.md

## 1. 数据设计原则

第一阶段使用本地 mock data，不接入云数据库。

数据文件：

```text
data/
  cars.js
  categories.js
```

所有页面必须从数据文件读取数据，不允许在页面 WXML 中硬编码车辆列表。

---

## 2. 车辆数据 cars

文件路径：

```text
data/cars.js
```

导出格式建议：

```js
const cars = [
  {
    id: "car_001",
    name: "MX-5 ND2",
    nickname: "北极星",
    brand: "Mazda",
    category: "supercar",
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
]

module.exports = cars
```

## 3. 车辆字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | 车辆唯一 ID |
| name | string | 是 | 车辆正式名称 |
| nickname | string | 是 | 车辆昵称，用于卡片左上角 |
| brand | string | 是 | 品牌 |
| category | string | 是 | 分类 ID |
| priceDay | number | 是 | 24 小时价格 |
| priceText | string | 是 | 前端展示价格文案 |
| status | string | 是 | 状态枚举 |
| statusText | string | 是 | 状态中文 |
| location | string | 是 | 取车城市 |
| tags | string[] | 是 | 标签 |
| transmission | string | 否 | 变速箱 |
| fuelType | string | 否 | 燃油类型 |
| seats | number | 否 | 座位数 |
| cover | string | 是 | 首页封面图 |
| images | string[] | 是 | 详情页图片 |
| description | string | 是 | 车辆简介 |
| sort | number | 是 | 排序字段 |

## 4. 状态枚举

```text
available      在库
rented         出库
maintenance    维护中
reserved       已预约
```

禁止新增状态，除非用户明确要求。

## Phase 11：公开价格摘要与通用租赁规则

公开车辆详情在现有 `priceDay` 基础上生成只读 `priceSummary`，不保存正式报价：

```js
{
  hasBasePrice: true,
  baseDailyRate: 599,
  currency: "CNY",
  currencySymbol: "￥",
  billingUnit: "24小时",
  baseDailyRateText: "￥599",
  estimateLabel: "基础日租参考"
}
```

运营配置 `app_configs.value.rentalTerms` 保存所有车辆共用的公开规则：

```js
{
  includedText: "基础日租包含内容",
  protectionText: "保障或保险说明",
  serviceFeeText: "服务费说明",
  deliveryFeeText: "取送车费用说明",
  depositText: "押金与退还规则",
  cancellationText: "取消与改期规则",
  overtimeText: "超时费用说明",
  energyText: "油量或电量规则",
  estimateDisclaimer: "预估价格、正式报价与车辆锁定边界"
}
```

规则字段公开读取前会去除首尾空白、限制为 200 字，并为旧配置的缺失字段补充默认文案。车辆只保存 `priceDay` 差异，不重复保存通用规则。

Phase 11 匿名分析事件包括：

```text
pricing_view
rental_rules_view
phone_call
share
availability_available
availability_conflict
availability_unknown
```

匿名事件仍只保存 `eventType`、`vehicleId` 和 `createdAt`，不保存 OpenID、姓名、手机号、预约备注、日期或城市。

## 5. 分类数据 categories

文件路径：

```text
data/categories.js
```

导出格式建议：

```js
const categories = [
  {
    id: "luxury_sedan",
    name: "豪华轿车"
  },
  {
    id: "city_suv",
    name: "城市SUV"
  },
  {
    id: "offroad",
    name: "硬派越野"
  },
  {
    id: "supercar",
    name: "超级跑车"
  },
  {
    id: "commuter_ev",
    name: "代步电车"
  },
  {
    id: "pickup",
    name: "皮卡"
  }
]

module.exports = categories
```

## 6. 分类枚举

```text
luxury_sedan    豪华轿车
city_suv        城市SUV
offroad         硬派越野
supercar        超级跑车
commuter_ev     代步电车
pickup          皮卡
```

## 7. 预约数据 bookings

第一阶段不真实保存预约数据，但表单结构按下面设计。

```js
{
  id: "booking_001",
  carId: "car_001",
  carName: "MX-5 ND2",
  userName: "张三",
  phone: "13800000000",
  startDate: "2026-06-25",
  endDate: "2026-06-26",
  city: "杭州",
  note: "希望下午取车",
  status: "pending",
  createdAt: "2026-06-23 12:00:00"
}
```

预约状态：

```text
pending      待联系
contacted    已联系
completed    已完成
cancelled    已取消
```

第一阶段只显示提交成功提示，不创建真实订单。

## 8. 数据约束

必须遵守：

- 车辆 id 唯一
- 车辆通过 carId 查询
- 分类通过 category id 匹配
- 不使用数组下标作为 id
- 不使用车辆名称作为唯一查询条件
- mock 车辆数量控制在 4-10 辆
- 图片路径允许先使用占位路径

## 9. Phase 12 报价版本 `booking_quotes`

报价使用独立集合保存；草稿文档 ID 为 `{bookingId}__draft`，已发送版本为 `{bookingId}__v{version}`。草稿可以覆盖保存，已发送版本不可静默修改。

```js
{
  _id: "booking_001__v1",
  bookingId: "booking_001",
  vehicleId: "car_001",
  vehicleName: "MX-5 ND2",
  startDate: "2026-08-10",
  endDate: "2026-08-12",
  rentalDays: 2,
  baseRentalCents: 120000,
  protectionCents: 10000,
  serviceFeeCents: 2000,
  deliveryFeeCents: 3000,
  otherFeeCents: 0,
  totalCents: 135000,
  depositText: "车辆押金与违章押金按规则退还",
  validUntil: "2026-08-11",
  customerNote: "用户可见报价说明",
  adjustmentNote: "用户申请调整时填写，最多 200 字",
  version: 1,
  status: "sent",
  responseStatus: "pending",
  sendRequestId: "幂等请求标识",
  createdAt: "服务端时间",
  sentAt: "服务端时间",
  updatedAt: "服务端时间"
}
```

所有金额以分为单位保存。`rentalDays` 根据预约日期计算，`totalCents` 由服务端对五项费用求和，客户端不提交或决定总额。

预约状态扩展为：

```text
pending                待联系
contacted              已联系
quoted                 已报价
adjustment_requested   用户申请调整
confirmed              用户已确认报价（尚未付款）
completed              已完成
cancelled              已取消
```

`bookings` 同步保存 `latestQuoteId`、`latestQuoteVersion`、`quotedAt`、`confirmedAt` 或 `adjustmentRequestedAt`，旧预约缺失这些字段时按空值和版本 0 读取。

访问和隐私规则：

- 用户报价详情必须先验证预约 `openid`，且只能读取 `latestQuoteId` 指向的版本；草稿不会返回用户端。
- 顾问报价操作必须具备 `booking_manage` 或管理员权限。
- 报价、用户可见备注和调整说明已纳入现有个人数据清单与 CSV 导出。
- 审计日志只保存预约 ID、报价 ID、版本、状态和金额摘要，不保存调整正文、手机号或其他表单内容。
- 确认报价不创建支付单、合同、押金冻结或车辆库存锁定。
