# Tasks

- [x] Task 1: 建立 Vehicle 数据结构与校验工具
  - [x] 定义前后端共用的字段枚举（vehicleType、status）
  - [x] 实现车牌号规范化与格式校验（包含新能源号牌）
  - [x] 实现 registerDate 格式与“不得晚于今天”的校验
  - [x] 产出可复用的校验返回结构（code/message/details）

- [x] Task 2: 新增前端新增车辆页面（含入口）
  - [x] 新增页面目录 `pages/vehicle-create/`（WXML/WXSS/JS/JSON）
  - [x] 在 `app.json` 注册页面路由
  - [x] 在 `pages/mine/mine` 增加“新增车辆”入口并完成跳转
  - [x] 实现表单输入与 picker（车辆类型、使用状态、注册日期）
  - [x] 实现提交前校验、格式限制、提交中状态、成功/失败 toast
  - [x] 适配多端（rpx + flex，不使用 grid 等不兼容特性）

- [x] Task 3: 新增后端云函数 vehicleCreate（含鉴权、去重、落库、日志）
  - [x] 新增 `cloudfunctions/vehicleCreate/` 云函数工程骨架
  - [x] 接入 `wx-server-sdk`，初始化云环境与数据库对象
  - [x] roles 鉴权：校验 openid 是否为 admin
  - [x] 参数校验与规范化：与 Task 1 一致
  - [x] 重复拦截：按 plateNumber 查询 vehicles，存在即拒绝
  - [x] 写入 vehicles：补齐 createdAt/updatedAt/createdByOpenid
  - [x] 异常捕获：返回 INTERNAL_ERROR，并记录 console.error（可选写入 operation_logs）

- [x] Task 4: 增加测试（单元测试 + 集成测试）
  - [x] 引入测试运行器与基础配置（在仓库选择合适方式，如 Node + Jest）
  - [x] 单元测试：校验函数（车牌号、日期、枚举、必填）
  - [x] 集成测试：云函数 vehicleCreate（mock admin / 非 admin、合法/非法/重复）
  - [x] 集成测试验证 vehicles 写入行为（使用可控的 mock db 层或测试库）

- [x] Task 5: 补充操作文档
  - [x] 在根目录 README 或 `jijing_garage_project_docs_v2/` 增加“新增车辆”章节
  - [x] 说明表单填写规范与字段含义
  - [x] 说明 roles 权限配置（如何设置 admin）
  - [x] 说明常见错误码与排查步骤

- [x] Task 6: 前端展示服务端校验错误详情
  - [x] 当云函数返回 VALIDATION_ERROR 且包含 details.errors 时，前端 toast 使用字段级可读提示（与本地校验一致）

# Task Dependencies

- Task 2 depends on Task 1（复用校验规则）
- Task 3 depends on Task 1（复用校验规则）
- Task 4 depends on Task 1 & Task 3（测试校验与云函数）
- Task 5 depends on Task 2 & Task 3（文档以最终交互与接口为准）
