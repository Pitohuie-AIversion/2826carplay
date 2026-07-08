# 根目录 README 编写计划

## Summary

- 目标：在项目根目录新增 `README.md`，作为仓库入口文档，面向开发者与协作人员，清晰说明项目定位、技术栈、功能范围、目录结构、运行方式和现有文档索引。
- 产出风格：中文、信息密度高、可快速上手；避免继续沿用 `jijing_garage_project_docs_v2/README.md` 中偏“Agent 执行流程”与阶段交付说明的写法。
- 范围限制：本次只新增根目录 README，不重写 `jijing_garage_project_docs_v2/README.md`，但会在新的 README 中链接该目录下已有详细文档。

## Current State Analysis

- 当前仓库为原生微信小程序项目，核心配置见 `app.json`、`app.js`、`project.config.json`。
- 项目首页为 `pages/garage/garage`，现有页面共 4 个：`garage`、`car-detail`、`booking`、`mine`。
- 数据层当前完全基于本地 mock 数据，主要来自 `data/cars.js` 与 `data/categories.js`。
- 页面能力已可从代码确认：
  - `pages/garage/garage.js`：分类筛选、车辆列表、电话联系、跳转详情、分享入口。
  - `pages/car-detail/car-detail.js`：车辆详情展示、状态提示、电话联系、跳转预约。
  - `pages/booking/booking.js`：本地表单校验、预约提交提示，不创建真实订单。
  - `pages/mine/mine.js`：静态个人中心入口页。
- 当前开发阶段为 Phase 10 已完成，处于“验收反馈修正与文档同步”状态，依据 `jijing_garage_project_docs_v2/CURRENT_PHASE.md`。
- 仓库根目录目前不存在 `README.md`；已有文档集中在 `jijing_garage_project_docs_v2/`，其中 `README.md` 偏内部交付说明，适合作为补充资料，不适合作为仓库首屏入口。

## Proposed Changes

### 1. 新增 `README.md`

- 文件：`g:\Autosave\2826carplay\README.md`
- 目的：为首次打开仓库的开发者/协作者提供统一入口，降低理解成本。
- 章节结构固定如下：
  1. 项目简介
  2. 功能概览
  3. 技术栈与实现方式
  4. 当前项目结构
  5. 本地运行方式
  6. 当前状态与范围边界
  7. 数据与页面说明
  8. 文档索引
- 每个章节的内容来源与写法：
  - `项目简介`：基于 `jijing_garage_project_docs_v2/README.md` 的业务定位，改写为仓库入口视角，突出“高质感汽车展示 + 预约咨询 MVP”。
  - `功能概览`：依据 `pages/garage/garage.js`、`pages/car-detail/car-detail.js`、`pages/booking/booking.js`、`pages/mine/mine.js` 提炼为用户可感知能力。
  - `技术栈与实现方式`：明确原生微信小程序技术栈（WXML/WXSS/JS/JSON），强调当前不使用 Taro、UniApp、Vue、React、TypeScript、云开发、自建后端。
  - `当前项目结构`：基于实际目录树编写，覆盖 `pages/`、`components/`、`data/`、`assets/`、`jijing_garage_project_docs_v2/`。
  - `本地运行方式`：基于 `project.config.json`、`app.json` 与已有文档，说明使用微信开发者工具导入、编译、预览的最短路径。
  - `当前状态与范围边界`：结合 `CURRENT_PHASE.md` 与现有 README，说明当前为 mock 数据 MVP，明确不包含支付、真实订单、云开发、后台系统等。
  - `数据与页面说明`：简要概括 `data/cars.js` 的 mock 数据角色，以及 4 个页面的职责边界。
  - `文档索引`：列出 `jijing_garage_project_docs_v2/` 下关键文档，例如 `CURRENT_PHASE.md`、`PROJECT_CONSTRAINTS.md`、`DATA_SCHEMA.md`、`CHANGELOG.md`、`TEST_CHECKLIST.md`。
- 编写原则：
  - 优先让新读者“3 分钟内理解项目是什么、怎么跑、哪些地方不能误解”。
  - 避免过度强调 Agent 执行指令、阶段式命令模板和一次性交付话术。
  - 保留对现有文档目录的指引，避免信息割裂。

### 2. 不修改现有文档目录 README

- 文件：`g:\Autosave\2826carplay\jijing_garage_project_docs_v2\README.md`
- 处理方式：本次不直接改动。
- 原因：该文档已承担内部阶段交付与扩展说明角色；为了避免入口文档和内部文档职责混淆，先通过根目录 README 做分层。

## Assumptions & Decisions

- 决策：采用“根目录新 README”方案，这是用户已确认的目标形态。
- 决策：README 使用中文，与当前项目文档语言保持一致。
- 决策：README 面向开发者/协作者，而非终端用户，因此会兼顾业务定位和工程上手信息。
- 决策：保留并引用 `jijing_garage_project_docs_v2/` 作为详细资料区，不把所有内部文档内容复制进根 README。
- 假设：当前仓库使用微信开发者工具进行主要开发与预览；CLI 预览只作为补充说明，不作为主流程。
- 假设：现阶段无需在 README 中加入复杂部署、构建流水线、测试命令或环境变量章节，因为仓库内不存在对应实现与脚本。

## Verification Steps

- 检查 `README.md` 是否放置在仓库根目录，且标题与首屏简介能准确说明项目定位。
- 检查 README 中列出的页面、目录、技术栈、运行方式是否与当前仓库实际内容一致。
- 检查 README 是否明确说明当前为 mock 数据 MVP，并写清不支持的能力边界，避免误导。
- 检查 README 是否包含对 `jijing_garage_project_docs_v2/` 关键文档的索引，方便继续深入阅读。
- 通读 README，确认内容适合作为仓库首页入口，而不是内部执行手册的复制版。
