# 极境车库微信小程序

## 1. 项目简介

极境车库微信小程序是一个面向汽车展示与预约咨询的微信小程序。第一阶段目标是完成一个高质感 MVP，用于展示车辆库存、车辆分类、车辆详情和基础预约表单。

当前版本定位：

```text
高质感汽车展示 + 租赁预约咨询
```

不是完整交易平台。第一阶段不做支付、押金、电子合同、真实订单和复杂后台。

## 2. 核心功能

第一阶段功能：

- 首页车辆展示
- 车辆分类筛选
- 车辆详情页
- 预约表单
- 我的页面静态入口
- 客服入口
- 电话入口
- 分享入口
- 本地 mock 数据驱动页面

## 3. 技术栈

本项目使用微信小程序原生开发：

- WXML
- WXSS
- JavaScript
- JSON

第一阶段不使用：

- Vue
- React
- Taro
- UniApp
- TypeScript
- 第三方 UI 框架
- 自建后端
- 微信云开发

## 4. 当前项目结构

```text
2826carplay/
  app.js
  app.json
  app.wxss
  sitemap.json
  project.config.json

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
    agent.md
    CURRENT_PHASE.md
    TODOlist.md
    CHANGELOG.md
    TEST_CHECKLIST.md
```

## 5. 开发流程

Agent 或开发者必须先阅读：

```text
agent.md
TODOlist.md
PROJECT_CONSTRAINTS.md
DESIGN.md
DATA_SCHEMA.md
TEST_CHECKLIST.md
```

建议执行方式：

```text
请先阅读 agent.md、TODOlist.md 和 PROJECT_CONSTRAINTS.md。
严格按照 TODOlist.md 从 Phase 0 开始执行。
每次只完成一个 Phase，完成后停止并汇报。
不得跳过阶段，不得新增超出 PROJECT_CONSTRAINTS.md 的功能。
```

## 6. 运行方式

1. 打开微信开发者工具
2. 导入项目根目录
3. 确认 `project.config.json` 中 `appid` 为有效小程序 `AppID`
4. 确认 `app.json` 中首页为：

```text
pages/garage/garage
```

5. 点击编译
6. 在模拟器中查看页面

如需使用 CLI 预览：

```text
G:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat preview --project g:\Autosave\2826carplay --port 60004 --lang zh --disable-gpu --qr-format terminal
```

当前项目已完成 CLI 预览打通，预览产物位于：

```text
g:\Autosave\2826carplay\.trae_preview_info.json
g:\Autosave\2826carplay\.trae_preview.txt
g:\Autosave\2826carplay\.trae_preview.jpg
```

## 7. 当前阶段

当前规划为：

```text
Phase 10（已完成）
MVP 本地 mock 数据版本
```

不接入：

- 支付
- 押金
- 真实订单
- 身份认证
- 驾驶证认证
- 云开发
- 自建服务器

当前状态补充：

- 微信开发者工具 CLI 已可正常 `open` 和 `preview`
- 当前项目可生成预览二维码并在真机扫码检查
- 当前车辆图片仍为本地占位图，不是最终正式素材

## 8. 后续可扩展方向

后续可以逐步扩展：

- 微信云开发数据库
- 车辆后台管理
- 预约记录管理
- 图片上传管理
- 用户登录
- 订单系统
- 支付系统
- 押金系统
- 合同系统

以上功能必须在第一版 MVP 完成后再评估。
