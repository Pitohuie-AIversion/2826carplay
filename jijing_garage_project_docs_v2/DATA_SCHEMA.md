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
