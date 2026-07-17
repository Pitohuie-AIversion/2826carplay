# 极境车库微信小程序

一个基于微信小程序原生能力开发的汽车展示与预约咨询 MVP 项目，当前聚焦“高质感车辆展示 + 基础预约沟通”，适合作为产品原型、演示样板和后续业务扩展基础。

## 项目简介

极境车库面向汽车展示与预约咨询场景，当前版本以本地 mock 数据驱动，完成了首页车库展示、分类筛选、车辆详情、预约表单和我的页面静态入口等核心流程。

该项目当前不是完整租车交易平台，不包含真实订单、支付、押金、身份认证、驾驶证认证、后台管理或云端数据能力。

## 功能概览

- 首页车辆展示
- 车辆分类筛选
- 车辆详情查看
- 预约咨询表单
- 电话联系入口
- 小程序分享入口
- 我的页面静态入口
- 本地 mock 数据驱动页面

当前页面结构如下：

```text
pages/garage/garage         首页车库
pages/car-detail/car-detail 车辆详情
pages/booking/booking       预约咨询
pages/mine/mine             我的页面
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
- 云开发
- 自建后端
- 数据库服务

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
- 当前版本为本地 mock 数据 MVP
- 当前进入验收反馈修正与文档同步阶段

当前已覆盖：

- 车辆分类展示与切换
- 车辆状态展示
- 详情页查看
- 预约表单基础校验
- 电话咨询与分享入口

当前不包含：

- 在线支付
- 押金支付
- 真实订单系统
- 自动排期
- 身份证认证
- 驾驶证认证
- 电子合同
- 云开发
- 自建服务端
- 后台管理系统

## 数据与页面说明

### 数据来源

当前所有页面均使用本地 mock 数据：

- `data/cars.js`：车辆列表与详情数据，当前包含 5 辆示例车辆
- `data/categories.js`：分类数据，当前包含 6 个分类

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
  - 读取本地车辆与分类数据
  - 进行分类筛选
  - 展示车辆卡片
  - 跳转详情页
  - 提供电话联系与分享能力
- `pages/car-detail/car-detail`
  - 按 `carId` 查询单辆车
  - 展示车辆图片、标签、状态和说明
  - 跳转预约页
  - 提供电话联系能力
- `pages/booking/booking`
  - 按 `carId` 读取车辆名称
  - 提供姓名、手机号、取还车日期、城市和备注输入
  - 执行基础表单校验
  - 只显示本地提交提示，不创建真实订单
- `pages/mine/mine`
  - 提供静态个人中心入口
  - 展示后续待开放能力的占位说明

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

## 后续扩展方向

在当前 MVP 基础上，后续可以继续评估：

- 云端数据接入
- 车辆后台管理
- 预约记录管理
- 图片素材管理
- 用户登录
- 订单系统
- 支付系统

以上能力不属于当前版本范围，是否推进需单独确认。
