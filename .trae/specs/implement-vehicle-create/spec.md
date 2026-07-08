# 车辆信息新增模块 Spec

## Why

当前项目已具备车辆展示与预约咨询的用户侧闭环，但缺少“车辆信息维护入口”。新增车辆信息模块用于支撑后续库存扩展与运营维护，并为后续车辆后台管理能力打基础。

## What Changes

- 新增车辆信息数据结构（Vehicle）与校验规则（必填字段、枚举、格式约束）
- 新增前端“新增车辆”页面（表单输入、格式限制、校验、提交反馈、适配多端）
- 新增后端（微信云开发）车辆新增接口（鉴权、参数校验、持久化、重复拦截、异常与日志）
- 新增单元测试与集成测试（合法提交、非法参数、重复数据、权限拦截）
- 补充操作文档（表单规范、权限要求、常见问题排查）

## Impact

- Affected specs:
  - 车辆数据模型与校验
  - 管理端新增车辆交互
  - 云函数 API 与权限控制
  - 测试体系（单测/集成）
  - 运维/操作文档
- Affected code:
  - [app.json](file:///g:/Autosave/2826carplay/app.json)（新增页面路由）
  - `pages/vehicle-create/*`（新增车辆页面）
  - [pages/mine/mine.*](file:///g:/Autosave/2826carplay/pages/mine/mine.js)（增加入口或菜单项）
  - `cloudfunctions/vehicleCreate/*`（新增云函数）
  - `cloudfunctions/shared/*`（共享校验与错误封装）
  - `tests/*`（新增测试用例与测试工具链）
  - `jijing_garage_project_docs_v2/*` 或根目录 `README.md`（补充操作文档）

## ADDED Requirements

### Requirement: Vehicle 数据结构与校验

系统 SHALL 定义车辆信息（Vehicle）数据结构，并对新增请求执行严格校验。

#### Vehicle 字段定义

- `plateNumber`（必填，字符串）
  - 作为车辆唯一键（用于重复拦截）
  - 规范化规则：去除首尾空格、转大写
  - 格式校验：符合中国大陆车牌基本格式（包含新能源号牌）
- `vehicleType`（必填，枚举）
  - 枚举值：`sedan`（轿车）、`suv`、`mpv`、`sports`（跑车）、`truck`（卡车）、`other`
- `brandModel`（必填，字符串）
  - 例如：`BMW 740Li`、`Mazda MX-5 ND2`
  - 长度限制：1–50
- `registerDate`（必填，日期字符串）
  - 格式：`YYYY-MM-DD`
  - 逻辑校验：不得晚于当前日期
- `status`（必填，枚举）
  - 枚举值：`active`（在用）、`idle`（闲置）、`maintenance`（维修）、`retired`（停用）

#### 可选字段（本次实现可先支持但不强制）

- `vin`（可选，字符串，长度 0–32）
- `engineNumber`（可选，字符串，长度 0–32）
- `note`（可选，字符串，长度 0–200）

#### 系统字段（由后端生成）

- `id`（字符串）：后端生成的唯一 id（建议使用云数据库 `_id` 或自生成 id）
- `createdAt`（时间戳 / ISO 字符串）
- `updatedAt`（时间戳 / ISO 字符串）
- `createdByOpenid`（字符串）：创建人 openid

#### Scenario: Success case（校验通过）

- **WHEN** 管理员提交新增车辆请求，且必填字段齐全、格式合法
- **THEN** 后端创建车辆记录并返回成功结果与车辆 id

#### Scenario: Failure case（校验失败）

- **WHEN** 提交字段缺失或格式非法
- **THEN** 后端返回可定位的错误码与错误信息，前端展示失败反馈且不落库

### Requirement: 前端新增车辆页面

系统 SHALL 提供新增车辆的交互页面，并具备完整的表单验证、输入限制与反馈机制。

#### 页面与入口

- 新增页面：`pages/vehicle-create/vehicle-create`
- 页面入口：在 `pages/mine/mine` 增加“车辆管理 / 新增车辆”菜单项或按钮

#### 表单要求

- 表单字段：车牌号、车辆类型、品牌型号、注册日期、使用状态（与后端必填一致）
- 输入限制：
  - 车牌号输入时自动转大写；禁止空格；长度限制；禁止非车牌字符
  - 注册日期通过日期选择器输入，输出格式 `YYYY-MM-DD`
  - 枚举字段使用 picker，避免自由输入导致非法值
- 校验时机：
  - 提交前统一校验
  - 必填缺失时给出字段级提示（toast 或表单下方提示均可，但需一致）

#### 提交流程与反馈

- **WHEN** 用户点击提交
  - **THEN** 进入提交中状态（按钮禁用，显示“提交中”）
  - **THEN** 调用云函数 `vehicleCreate`
- 成功反馈：
  - toast “新增成功”
  - 表单重置或返回上一页（需在实现中选定一种并保持一致）
- 失败反馈：
  - toast 显示可读错误信息
  - 保留用户已输入内容，允许修正后重试

#### 响应式适配

- SHALL 使用 `rpx` 与 `flex` 布局适配不同设备尺寸
- SHALL 避免使用 `display: grid` 等不兼容特性

### Requirement: 后端（云开发）新增车辆接口

系统 SHALL 提供云函数接口以创建车辆记录，并具备鉴权、校验、持久化、去重、异常处理和日志记录。

#### 接口定义

- 云函数名：`vehicleCreate`
- 输入：Vehicle 必填字段 + 可选字段
- 输出：
  - 成功：`{ ok: true, id: string }`
  - 失败：`{ ok: false, code: string, message: string, details?: any }`

#### 权限控制（微信登录 + 角色）

- SHALL 使用调用上下文 openid 标识请求方（云函数 context）
- SHALL 在云数据库 `roles` 集合中校验 openid 是否具备 `admin` 角色
- **WHEN** 非 admin 调用接口
  - **THEN** 返回 `code=FORBIDDEN`

#### 数据持久化

- 云数据库集合：`vehicles`
- 写入前必须执行：
  - 参数校验（与 Vehicle 校验一致）
  - 数据规范化（`plateNumber` 转大写等）
  - 重复拦截（以 `plateNumber` 去重）

#### 重复数据拦截

- **WHEN** `vehicles` 中已存在相同 `plateNumber`
  - **THEN** 返回 `code=DUPLICATE_PLATE`
  - **THEN** 不写入新记录

#### 异常捕获与错误日志

- SHALL 捕获云函数内部异常并返回 `code=INTERNAL_ERROR`
- SHALL 记录错误日志，至少包含：
  - `function`: `vehicleCreate`
  - `openid`
  - `plateNumber`（如可得）
  - `errorMessage`
  - `stack`（如可得）
  - `createdAt`
- 日志落地方式：
  - 云函数 `console.error`（默认云端日志）
  - 可选：写入 `operation_logs` 集合（如实现时决定启用，需在文档说明）

### Requirement: 测试覆盖

系统 SHALL 提供单元测试与集成测试，覆盖关键路径并可重复运行。

#### Scenario: 合法数据提交

- **WHEN** 以 admin 身份提交合法车辆数据
- **THEN** 返回 ok
- **THEN** `vehicles` 集合新增记录

#### Scenario: 非法参数拦截

- **WHEN** 缺少必填字段（如车牌号）或车牌格式非法
- **THEN** 返回 ok=false 且 code=VALIDATION_ERROR
- **THEN** 不写入记录

#### Scenario: 重复数据提交

- **WHEN** 使用已存在的车牌号再次提交
- **THEN** 返回 ok=false 且 code=DUPLICATE_PLATE
- **THEN** 不写入记录

#### Scenario: 权限拦截

- **WHEN** 非 admin 提交新增请求
- **THEN** 返回 ok=false 且 code=FORBIDDEN

### Requirement: 操作文档

系统 SHALL 补充新增车辆功能的操作说明，包含表单填写规范、权限要求与常见问题排查。

#### 文档内容范围

- 表单字段填写规则（车牌号格式、日期格式、枚举含义）
- 权限控制要求（如何配置 admin 角色/roles 集合）
- 常见失败原因与排查（权限不足、重复车牌、格式非法、云函数未部署、云环境未初始化）

## MODIFIED Requirements

### Requirement: 现有小程序导航

系统 SHALL 在不破坏现有页面流程的前提下，新增“新增车辆”入口（从我的页面进入）。

## REMOVED Requirements

无
