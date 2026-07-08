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

## 9. 新增车辆（管理员）

“新增车辆”用于在云开发数据库中创建车辆记录，入口位于“我的”页面。该功能依赖微信云开发（云函数 + 云数据库），未开通或未部署时不可用。

### 9.1 表单填写规范

必填字段：

- 车牌号（plateNumber）
  - 自动转为大写并去除空格
  - 仅允许中文省份简称 + 字母数字组合（支持新能源号牌），长度不超过 8
  - 示例：京A12345、沪AD12345、粤B12345D
- 车辆类型（vehicleType，枚举）
  - sedan（轿车）
  - suv（SUV）
  - mpv（MPV）
  - sports（跑车）
  - truck（卡车）
  - other（其他）
- 品牌型号（brandModel）
  - 长度 1-50
  - 建议格式：品牌 + 车系/型号，例如“BMW 3系 330i”
- 注册日期（registerDate）
  - 格式必须为 YYYY-MM-DD
  - 不得晚于当天
- 使用状态（status，枚举）
  - active（在用）
  - idle（闲置）
  - maintenance（维修）
  - retired（停用）

### 9.2 权限控制与 roles 集合配置

云函数 `vehicleCreate` 会使用调用者的 openid 做鉴权：仅当 `roles` 集合中存在该 openid 且具备 admin 标记时，才允许新增车辆。

roles 集合的 admin 配置方式（满足任一即可）：

- 方式一：单字段 role
  - `{ "openid": "OPENID_XXX", "role": "admin" }`
- 方式二：数组字段 roles
  - `{ "openid": "OPENID_XXX", "roles": ["admin"] }`
- 方式三：布尔字段
  - `{ "openid": "OPENID_XXX", "isAdmin": true }`
  - 或 `{ "openid": "OPENID_XXX", "admin": true }`

openid 获取方式：

- 方式一：通过云函数上下文获取
  - 云函数内可通过 `cloud.getWXContext().OPENID` 获取当前调用者 openid
  - 可临时创建一个仅返回 openid 的云函数用于自助查询，得到 openid 后再写入 roles 集合
- 方式二：从云函数日志获取
  - 当出现 `FORBIDDEN` 或 `INTERNAL_ERROR` 时，云函数日志中通常能定位到调用者 openid（取决于日志输出与调用路径）

### 9.3 常见错误码与排查

错误码说明（以云函数返回为准）：

- FORBIDDEN：权限不足
  - 排查：确认已创建 `roles` 集合；确认存在 `{ openid: 当前用户openid }` 的记录；确认记录包含 admin 标记（role/roles/isAdmin/admin 任一）
  - 排查：确认调用时确实在同一云环境中（多环境时 openid 不变但数据可能写在不同环境的库中）
- VALIDATION_ERROR：参数校验失败
  - 排查：检查必填字段是否都已填写
  - 排查：车牌号是否符合号牌规则（含新能源号牌），是否包含空格或特殊字符
  - 排查：注册日期是否为 YYYY-MM-DD 且不晚于当天
  - 排查：vehicleType、status 是否为枚举值（见 9.1）
- DUPLICATE_PLATE：车牌号已存在
  - 排查：在 `vehicles` 集合中按 `plateNumber` 查询是否已存在同车牌记录
  - 处理：如确需录入，先清理或更正已存在记录（确保车牌号唯一）
- INTERNAL_ERROR：系统繁忙/内部异常
  - 排查：确认已开通微信云开发并已选择/绑定有效云环境
  - 排查：确认云函数 `vehicleCreate` 已上传并部署成功（开发者工具云函数面板可查看）
  - 排查：确认前端已初始化云能力
    - 页面会在 onLoad 时尝试 `wx.cloud.init({ traceUser: true })`
    - 若项目有多个云环境，需在 init 时显式指定 `env`，确保与云函数部署环境一致
  - 排查：确认云数据库集合存在
    - `roles`：用于鉴权
    - `vehicles`：用于写入车辆数据
  - 排查：查看云函数日志，定位具体异常信息（集合不存在、权限、参数结构不符合等）
