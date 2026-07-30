# 极境车库微信小程序

## 状态更新

- 当前代码已接入微信云开发，不再是纯本地 mock MVP
- 已具备车辆管理、预约管理、权限管理、运营配置、上线检查、审计日志、错误日志等后台能力
- 本地自动化回归基线：`66 suites / 292 tests`
- 上线执行清单见 `DEPLOY_CHECKLIST.md`

一个基于微信小程序原生能力开发的汽车展示与预约咨询 MVP 项目，当前聚焦“高质感车辆展示 + 基础预约沟通”，适合作为产品原型、演示样板和后续业务扩展基础。

## 项目简介

极境车库面向汽车展示与预约咨询场景，当前版本由微信云开发驱动，已完成首页车库展示、分类筛选、车辆详情、预约咨询、我的预约和后台运营管理等核心流程。

该项目当前不是完整租车交易平台，不包含在线支付、押金支付、身份证或驾驶证认证、电子合同和自动库存锁定。

## 功能概览

- 首页车辆展示
- 车辆分类筛选
- 车辆详情查看
- 预约咨询表单
- 电话联系入口
- 小程序分享入口
- 我的预约、联系方式修改与取消
- 车辆收藏、收藏列表与取消收藏
- 预约提交时订阅状态提醒，后台更新后发送微信通知
- 预约选日期时显示车辆同期咨询数量，并支持继续提交候补
- 管理员在预约详情中查看同车重叠记录并快捷拨号、跳转处理
- 预约管理员可设置优先、常规、候补级别并记录协调进度
- 预约列表支持按业务状态、优先级和协调进度组合筛选及导出
- 待协调工作台集中展示待启动、协调中、优先、候补与超时预约，支持阶段筛选、本地搜索及一键开始、完成协调
- 个人信息查询、更正、删除申请与处理进度
- 管理员按隐私申请核对相关预约、收藏、统计与申请记录
- 按权限汇总预约、车辆与隐私待办的运营概览
- 匿名车辆热度、预约漏斗和近 7/30 天趋势分析
- 按月查看跨天预约、待联系数量和涉及车辆的预约日历
- 管理员只读检查关键数据集合、数据规模、运营配置与订阅模板
- 车辆、预约、权限和运营配置后台
- 隐私申请处理后台
- 审计日志与错误日志筛选、CSV 导出归档
- 预约与日志导出文件支持设备端安全删除和旧文件自动替换
- 微信云开发数据库、云函数和云存储

当前页面结构如下：

```text
pages/garage/garage         首页车库
pages/car-detail/car-detail 车辆详情
pages/booking/booking       预约咨询
pages/mine/mine             我的页面
pages/bookings/bookings     我的预约
pages/favorites/*           我的收藏
pages/privacy-request/*     个人信息申请
pages/operations-overview/* 运营概览
pages/analytics-manage/*    数据分析
pages/booking-calendar/*    预约日历
pages/booking-workbench/*   待协调工作台
pages/system-health/*       上线检查
pages/vehicle-manage/*      车辆管理
pages/booking-manage/*      预约管理
pages/privacy-request-manage/* 隐私申请处理
pages/privacy-data-inventory/* 隐私相关数据清单
```

## 技术栈与实现方式

本项目使用微信小程序原生开发：

- WXML
- WXSS
- JavaScript
- JSON
- 微信小程序原生 API

当前阶段明确不使用：

- Vue
- React
- Taro
- UniApp
- TypeScript
- 第三方 UI 框架
- 自建后端
- 在线支付能力

## 当前项目结构

```text
2826carplay/
  app.js
  app.json
  app.wxss
  project.config.json
  project.private.config.json
  sitemap.json

  pages/
    garage/
    car-detail/
    booking/
    mine/

  components/
    car-card/

  cloudfunctions/
    bookingCreate/
    garageVehicleList/
    vehiclePublicDetail/
    ...

  data/
    cars.js
    categories.js

  assets/
    cars/

  jijing_garage_project_docs_v2/
    README.md
    CURRENT_PHASE.md
    PROJECT_CONSTRAINTS.md
    DATA_SCHEMA.md
    CHANGELOG.md
    TEST_CHECKLIST.md
    ...
```

## 本地运行方式

### 方式一：微信开发者工具

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 选择项目根目录 `g:\Autosave\2826carplay`。
4. 确认 `project.config.json` 中已配置 AppID。
5. 编译并在模拟器中查看页面。

当前首页路由为：

```text
pages/garage/garage
```

### 方式二：CLI 预览

如果本地已经正确开启微信开发者工具 CLI 服务端口，可参考已有项目文档中的预览方式进行二维码预览。当前仓库也保留了预览产物：

```text
.trae_preview_info.json
.trae_preview.txt
.trae_preview.jpg
```

## 当前状态与范围边界

当前状态：

- Phase 10 已完成
- 当前版本已接入微信云开发
- 当前进入上线前安全、隐私与真机验收阶段

当前已覆盖：

- 车辆分类展示与切换
- 车辆状态展示
- 详情页查看
- 预约表单基础校验
- 预约记录创建、查询、联系方式修改与取消
- 车辆详情收藏与个人收藏列表
- 可配置的预约状态订阅消息与失败降级
- 个人信息查询、更正和删除申请
- 车辆、预约、权限与运营配置后台
- 管理员隐私申请处理与审计
- 隐私申请关联数据的只读核验与不完整结果提醒
- 预约、车辆状态与待办提醒汇总
- 不保存用户身份的车辆热度与预约转化分析
- 人工排期参考用的月度预约日历
- 用户端档期预览与后台同车重叠提醒（仅提醒，不自动锁车）
- 面向预约管理员的待协调优先队列与 24 小时超时提醒
- 管理员上线前云环境只读诊断
- 公开车牌脱敏与预约提交频率保护
- 电话咨询与分享入口

当前不包含：

- 在线支付
- 押金支付
- 真实订单系统
- 自动排期
- 身份证认证
- 驾驶证认证
- 电子合同
- 自建服务端

## 数据与页面说明

### 数据来源

车辆、预约、收藏、匿名统计、权限、隐私申请和运营配置来自微信云开发：

- `vehicles`：车辆信息
- `bookings`：预约咨询记录
- `favorites`：用户车辆收藏记录
- `analytics_events`：不含 OpenID 和表单内容的行为事件
- `roles`：后台权限
- `app_configs`：运营配置
- `privacy_requests`：个人信息权利申请与处理状态
- `data/categories.js`：首页分类配置
- `data/cars.js`：仅保留为早期示例数据，不参与当前线上主流程

当前分类包括：

- `luxury_sedan`：豪华轿车
- `city_suv`：城市SUV
- `offroad`：硬派越野
- `supercar`：超级跑车
- `commuter_ev`：代步电车
- `pickup`：皮卡

车辆状态字段统一使用：

- `available`：在库
- `reserved`：已预约
- `rented`：已租出
- `maintenance`：维护中

### 页面职责

- `pages/garage/garage`
  - 通过 `garageVehicleList` 读取公开车辆数据
  - 进行分类筛选
  - 展示车辆卡片
  - 跳转详情页
  - 提供电话联系与分享能力
- `pages/car-detail/car-detail`
  - 通过 `vehiclePublicDetail` 按 `carId` 查询单辆车
  - 展示车辆图片、标签、状态和说明
  - 跳转预约页
  - 提供电话联系能力
- `pages/booking/booking`
  - 按 `carId` 读取车辆信息
  - 提供姓名、手机号、取还车日期、城市和备注输入
  - 执行表单校验、隐私确认、重复预约和频率限制
  - 创建预约咨询记录，不创建支付订单
- `pages/mine/mine`
  - 提供我的预约、客服、规则和隐私政策入口
  - 根据服务端权限动态展示管理入口

## 文档索引

更多详细说明位于 `jijing_garage_project_docs_v2/` 目录，建议按需阅读：

- `jijing_garage_project_docs_v2/README.md`
  - 项目背景、阶段定位和更完整的内部说明
- `jijing_garage_project_docs_v2/CURRENT_PHASE.md`
  - 当前阶段、执行规则和验收修正状态
- `jijing_garage_project_docs_v2/PROJECT_CONSTRAINTS.md`
  - 项目范围、技术栈、数据结构和实现约束
- `jijing_garage_project_docs_v2/DATA_SCHEMA.md`
  - 数据字段说明
- `jijing_garage_project_docs_v2/CHANGELOG.md`
  - 变更记录
- `jijing_garage_project_docs_v2/TEST_CHECKLIST.md`
  - 测试与验收检查项
- `jijing_garage_project_docs_v2/WECHAT_REVIEW_AND_PRIVACY.md`
  - 微信审核与隐私相关说明

## 上线准备

代码发布、数据库集合、索引、环境变量、安全规则、微信备案和真机验收要求统一记录在 `DEPLOY_CHECKLIST.md`。支付、合同、证件认证和自动排期仍不属于当前版本范围。
