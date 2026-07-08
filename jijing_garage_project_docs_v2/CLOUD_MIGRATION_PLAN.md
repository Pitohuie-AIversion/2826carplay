# CLOUD_MIGRATION_PLAN.md

## 1. 目标

本项目第一阶段使用本地 mock data。  
当 MVP 页面稳定后，再迁移到微信云开发。

本文件只做后续规划，不允许 Agent 在第一阶段提前接入云开发。

## 2. 迁移顺序

推荐迁移顺序：

```text
Step 1：本地 mock 数据版本稳定
Step 2：开通微信云开发
Step 3：创建 cars 集合
Step 4：创建 bookings 集合
Step 5：将首页车辆数据替换为云数据库读取
Step 6：将预约表单提交到 bookings 集合
Step 7：增加简单管理端或使用云开发控制台维护数据
```

## 3. 云数据库集合规划

### cars 集合

字段参考 `DATA_SCHEMA.md`。

核心字段：

```text
id
name
nickname
brand
category
priceDay
priceText
status
statusText
location
tags
cover
images
description
sort
createdAt
updatedAt
```

### bookings 集合

核心字段：

```text
id
carId
carName
userName
phone
startDate
endDate
city
note
status
createdAt
updatedAt
```

## 4. 第一阶段禁止内容

第一阶段禁止：

- 初始化云开发
- 创建云函数
- 创建云数据库
- 修改 app.js 云开发配置
- 将 mock 数据改成云数据库读取

## 5. 第二阶段迁移原则

迁移时必须保持：

- 页面 UI 不变
- 页面路由不变
- 车辆数据结构不变
- carId 查询逻辑不变
- 预约表单字段不变

## 6. 后台管理建议

早期不建议开发复杂后台。可以先用：

```text
微信云开发控制台维护车辆数据
```

后续再考虑：

```text
admin-car-list
admin-car-edit
admin-booking-list
```

后台必须等 MVP 前台稳定后再做。
