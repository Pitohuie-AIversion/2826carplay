# 极境车库小程序 - 性能优化专项 (Performance Optimization) PRD

## Overview
- **Summary**: 针对微信小程序端用户体感的"点击详情卡加载慢"、"列表滑动偶发掉帧"、"预约工作台操作反馈慢"三大类问题，系统性进行代码与架构层面的性能优化，覆盖 setData 频次与体积、列表页首屏渲染、云函数响应效率、分包加载与包体积、高频操作反馈链路五个核心维度。
- **Purpose**: 在保持业务功能零回归的前提下，显著降低关键页面的首屏渲染时长、操作响应延迟与卡顿率，提升中端机型（千元机 Android）上的体感流畅度，减少用户等待过程中的流失率。
- **Target Users**: C 端租车用户（车库浏览 / 下单 / 订单查看）、门店运营人员（工作台操作）、后台管理员（管理后台页面）。

## Goals
1. **首屏打开速度**：车库首页、车辆详情、预约详情三个高频 C 端页面首次进入首屏可交互时长相对基线缩短 ≥ 30%。
2. **操作流畅度**：预约工作台、预约详情中的操作（报价确认、备注修改、状态流转）单次用户动作对应的 `setData` 调用次数降低 ≥ 50%，无肉眼可见的"按了没反应"。
3. **云函数效率**：`garageVehicleList` 车辆列表接口在 100 台库存规模下 P95 响应时间 ≤ 600ms；内存中不做全表扫描排序。
4. **列表渲染性能**：车库列表页 50 条数据规模下，持续上下滚动无明显掉帧（以小程序 DevTools Performance 面板中 FPS ≥ 40 为基线）。
5. **包体积控制**：主包不包含纯管理后台页面，主包构建后体积（不含云函数）在当前基线基础上缩减 ≥ 25%。

## Non-Goals
1. 不重构微信小程序框架底层（不切换 Taro/uni-app 等跨端方案）。
2. 不涉及业务功能改造（不改变预约流程、状态机逻辑、权限体系）。
3. 不做原生插件/Canvas 等硬件级别的渲染加速。
4. 不做云数据库大表结构迁移（不修改 vehicles 等集合字段定义，仅优化查询与投影）。
5. 不接入外部性能监控 SDK（接入新 SDK 作为后续独立工作项）。

## Background & Context

### 现状扫描摘要
- **setData 频次统计**：Pages 层合计 427 次调用（26 个页面），Components 层 5 次。Top 3 高频页面：booking-manage-detail (36次)、booking-workbench (33次)、booking (25次)、booking-detail (32次)。
- **车库页数据冗余**：`garage.js` `applyCars` 先 `setData({ cars })`，再 `filterCars` 中 `setData({ filteredCars })`。两份数组引用几乎完全相同的车辆对象（含 description/images 大字段），逻辑层→渲染层序列化体积翻倍。
- **云函数端全表扫描**：`garageVehicleList` 云函数 `readVehicles()` 采用 `skip/limit` 分批读取 `MAX_VEHICLE_RECORDS=2000` 全量车辆，然后在 Node.js 进程内存内 `.filter().map().sort().slice()` 实现分页；不利用数据库 `orderBy` + `skip/limit` 的原生分页能力。
- **无分包**：`app.json` 26 个页面全部在主包。其中 `analytics-manage` / `role-manage` / `config-manage` / `audit-log-manage` / `error-log-manage` / `system-health` / `vehicle-manage` / `vehicle-create` / `vehicle-edit` / `vehicle-detail-manage` / `operations-overview` / `privacy-request-manage` / `privacy-data-inventory` 等 13 个页面为纯后台管理页面，普通 C 端用户永不访问。
- **搜索未防抖**：`garage.js` `handleSearchInput` 每次按键都直接执行 `filterCars` + `setData`（虽然有 `searchDebouncing` 状态但未实际应用 debounce delay）。
- **异步 setState 模式冗余**：`booking-detail.respondToQuote`、`booking-workbench.handleSaveRemark`、`booking-workbench.updateContactedStatus` 等函数普遍存在"请求前 `setData({ loading: true })` → 请求后 `setData({ loading: false, ... })`"成对出现的模式，部分请求失败分支与超时分支重复设置相同字段。

### 已完成工作（前置）
- 图片加载缓存机制（`shared/imageCache.js`、`car-card`、`car-detail`、`garage` 跳转前预加载）已落地，本次专项不重复覆盖。

## Functional Requirements
- **FR-1 车库列表字段瘦身**：车库首页 setData 的车辆对象只保留卡片渲染与分类搜索所需字段（id/name/nickname/category/priceDay/priceText/status/statusText/location/tags/cover/seatsText/coverPlaceholderText/sort/brand），去除卡片未使用的 `description`、`images` 全量数组、`registerDate`、`updatedAt`、`createdAt`、`transmission`、`fuelType`、`seats`（保留 seatsText）、`hasImages` 等字段。
- **FR-2 车库搜索防抖**：首页搜索框在输入停止后 N ms（建议 200~300ms）才执行 `filterCars` 与 setData，连续快速输入过程中不触发重渲染。
- **FR-3 预约工作台 setData 合并**：`booking-workbench`、`booking-detail`、`booking-manage-detail`、`booking` 中的异步操作（备注保存、状态更新、报价响应、取消操作等）"loading true/false"成对合并为一次 `applyState` 批量更新；失败分支与超时分支不重复 setData 相同字段。
- **FR-4 车库云函数原生分页与投影**：`garageVehicleList` 不再一次性读取 MAX_VEHICLE_RECORDS 条，直接在 DB 层按参数 `orderBy + skip(page*pageSize) + limit(pageSize)` 查询；分页元数据通过一次 `count()` 与聚合分类统计获取，而非内核对全表 map。
- **FR-5 管理后台页面分包**：13 个纯管理后台页面迁移到 `subPackages/admin` 分包；`role-manage` 作为分包入口前置权限检查不变；公共组件与 `shared/*` 保留在主包或提取为主包公共模块。
- **FR-6 车库 applyCars 合并**：`applyCars` 与紧随其后的 `filterCars` 产生的两次大体量 setData，合并为一次 setData 同时写入 `cars` + `filteredCars` + 元数据（category/categories 等）。
- **FR-7 预约详情冗余 setData 消除**：`booking-detail.applyBooking` 中所有可合并的 setState 合并为一次 apply；`loadDetail` 中 loading/initialLoading/loadFailed 等字段的多次赋值合并。

## Non-Functional Requirements
- **NFR-1 零功能回归**：`__tests__/carCardStyle.test.js`、`__tests__/carDetail.page.test.js`、`npm run check:structure` 三项测试（及本仓库存在的其他测试）全部通过；无新增 lint / diagnostics 错误。
- **NFR-2 向后兼容**：分包后普通用户访问主包页面路径不变（`pages/garage/garage`、`pages/car-detail/car-detail` 等依旧在主包），管理员通过 `pages/mine/mine` 中的入口跳转到分包页面时按小程序分包加载机制自动拉取。
- **NFR-3 云函数协议不变**：`garageVehicleList` 返回 JSON 结构字段 `ok / page / pageSize / total / searchedTotal / categoryTotal / availableCount / categoryCounts / truncated / hasMore / list` 与现有调用方完全兼容；只优化实现不改签名。
- **NFR-4 可观测性**：车库搜索防抖、云函数分页失败降级时保留原 `warn/error` 日志输出习惯，不新增需要额外 SDK 才能看到的埋点。
- **NFR-5 代码规范一致**：沿用现有 `const`/双引号/分号风格、错误处理 `fail/handleFailure` 回调模式、`_` 前缀内部状态字段惯例。

## Constraints
- **Technical**: 微信小程序原生框架（非跨端）；必须兼容最低基础库版本 `requiredPrivateInfos` 对应版本（项目默认配置），不得使用未在文档中的私有 API。分包必须遵循小程序独立分包/普通分包规则，分包不能反向依赖主包私有路径。
- **Business**: 管理员入口（我的 → 管理入口）跳转路径不能断链，后台页面从主包迁移到分包后需要确保权限检查 `getMyPermissions` 云函数依旧在进入前执行。
- **Dependencies**: 不引入任何新 npm 依赖（防抖、合并 setState 等逻辑用内聚小工具实现）；不改变 `wx-server-sdk` / Jest 等既有依赖版本。

## Assumptions
1. 车辆列表真实生产规模 ≤ 500 台，`aggregate` 或 `count()` 性能可接受，不做冷分库分表。
2. 管理员角色占总用户比例 ≤ 5%，首次进入管理页面时触发的分包下载 2~3s 可接受。
3. 卡片渲染不依赖 description/images 数组等字段（已通过 `car-card.wxml` 审查确认只用到 cover/nickname/priceText/tags/statusText 等）。
4. 现有测试 `carCardStyle` 与 `carDetail.page` 覆盖的 WXML 结构在本次合并且不改变。

## Open Questions
- [ ] 是否需要同步在 `booking-list` / `favorites` 页面接入列表字段瘦身？（假设"否"，本期只优化 Top 2 高频列表：车库、工作台，如管理员反馈工作台仍卡顿再做后续迭代）
- [ ] `booking-manage-detail` 36 次 setData 是否一并纳入本次合并，还是作为第二迭代？（假设"是"，预约相关 4 页（booking、booking-detail、booking-workbench、booking-manage-detail）全部合并）

## Acceptance Criteria

### AC-1: 车库单次进入 setData 次数减半
- **Type**: `rule`
- **Given**: 冷启动进入车库首页，数据加载一次完成
- **When**: 在 DevTools 中开启 AppData 面板观察 setData，或手动埋点 `wx.setStorageSync` 计数
- **Then**: 从 `onLoad` 到首屏渲染稳定，车库页顶层 `setData` 调用次数 ≤ 6 次（基线 9 次），且 `applyCars` 和 `filterCars` 的两次大数组 setData 合并为一次
- **Pass Condition**: 计数统计 ≤ 6 次，且一次 setData 中同时包含 cars 与 filteredCars 字段
- **Evidence**: `garage.js` 代码审查 + 运行期埋点日志输出；`npm run check:structure` 通过

### AC-2: 车库卡片数据体积缩减 ≥ 40%
- **Type**: `rule`
- **Given**: 车库列表返回 39 辆车（mock 基线），序列化字符串 `JSON.stringify(cars)`
- **When**: 对比优化前（含 description/images 全量数组）与优化后
- **Then**: 优化后 `cars` 数组的 JSON 字符串长度 ÷ 优化前 ≤ 60%
- **Pass Condition**: 比例 ≤ 0.6
- **Evidence**: 在 Node REPL 或 DevTools Console 中对 mock cars 执行瘦身前后 `JSON.stringify(...).length` 对比，并在 tasks.md 的 Completion Evidence 中贴出具体数字

### AC-3: 搜索防抖生效，输入期间不触发 filterCars
- **Type**: `rule`
- **Given**: 车库首页打开，搜索框聚焦
- **When**: 用户以每 100ms 输入一个字符的节奏连续敲击 5 个字符
- **Then**: `filterCars` 在第 1~4 次按键之间不执行，仅在最后一次按键并经过 250ms 静默后执行一次
- **Pass Condition**: 输入 5 字符场景下 `filterCars` 总执行次数 = 1（±1 考虑边界）
- **Evidence**: `garage.js` 代码审查 + 单元测试或 console 计数日志

### AC-4: 预约工作台单动作 setData 次数 ≤ 2
- **Type**: `rule`
- **Given**: 预约工作台打开并加载完成，选中一条待处理预约
- **When**: 执行一次"保存备注"操作（从点击到 Toast 结束）
- **Then**: 动作触发的顶层 setData 调用次数 ≤ 2 次（基线 3~4 次）
- **Pass Condition**: 计数 ≤ 2
- **Evidence**: `booking-workbench.js` `handleSaveRemark` 代码审查 + 运行期计数；同类动作（更新状态、保存协调内容）模式一致

### AC-5: 预约详情单动作 setData 次数 ≤ 2
- **Type**: `rule`
- **Given**: 预约详情已加载，状态为 quoted
- **When**: 点击"确认报价"或"申请调整"并完成
- **Then**: 动作触发的顶层 setData 调用次数 ≤ 2 次
- **Pass Condition**: 计数 ≤ 2
- **Evidence**: `booking-detail.js` `respondToQuote` 代码审查

### AC-6: garageVehicleList 不再读取 MAX_VEHICLE_RECORDS 全量记录
- **Type**: `rule`
- **Given**: 云函数接收到 `page=0&pageSize=20`
- **When**: 观察数据库 `vehicles` 集合的查询语句
- **Then**: 使用 `.orderBy().skip(0).limit(20).get()` 执行分页；`count()` 用于 total / `aggregate()` 用于分类统计；不存在按 100 为 batch 循环读取的 `for` 循环
- **Pass Condition**: 代码审查确认 `readVehicles()` 删除；分页元数据用 `count` + 聚合；分类统计用聚合
- **Evidence**: `cloudfunctions/garageVehicleList/index.js` 代码审查

### AC-7: 13 个管理后台页面迁移到分包
- **Type**: `rule`
- **Given**: 查看 `app.json`
- **When**: 读取 pages 数组与 subPackages 数组
- **Then**: 以下 13 个页面仅出现在 `subPackages[].pages`，不再出现在主包 `pages` 数组：analytics-manage、role-manage、config-manage、audit-log-manage、error-log-manage、system-health、vehicle-manage、vehicle-create、vehicle-edit、vehicle-detail-manage、operations-overview、privacy-request-manage、privacy-data-inventory
- **Pass Condition**: 13 个页面全部在分包中；主包剩余页面路径不变
- **Evidence**: `app.json` 静态审查 + `npm run check:structure` 通过 + 从"我的→管理入口"手动跳转分包页路径生效

### AC-8: 主包构建体积相对基线缩减 ≥ 25%
- **Type**: `rubric`
- **Dimension**: 主包代码与资源体积压缩效果
- **Scale**: 1-5
  - 1 = 缩减 < 10% 或反增；
  - 3 = 缩减 15% ~ 24%；
  - 5 = 缩减 ≥ 25% 且分包后所有页面跳转链接验证通过
- **Pass Threshold**: >= 4
- **Evidence**: DevTools 详情 → 基本信息 → 主包大小（分包前 vs 分包后）截图或数字对比；`miniprogram_npm`、images、data 等静态资源不计入差值（只计 pages 与依赖的公共模块搬运带来的差异）

### AC-9: 车库列表滚动 FPS 保持 ≥ 40
- **Type**: `rubric`
- **Dimension**: 列表滚动流畅度
- **Scale**: 1-5
  - 1 = FPS < 30，肉眼可见明显卡顿；
  - 3 = FPS 30~39，偶发轻微掉帧；
  - 5 = FPS ≥ 40 且稳定，全程滚动无肉眼可感知卡顿
- **Pass Threshold**: >= 4
- **Evidence**: DevTools Performance 面板录制 10s 持续滚动的 FPS 曲线截图或统计；车辆列表数据量模拟到 50 条执行

### AC-10: 全量现有测试通过且 0 lint/类型错误
- **Type**: `rule`
- **Given**: 优化改动全部提交到工作区
- **When**: 运行 `npm run check:structure`、Jest 中直接相关测试、GetDiagnostics
- **Then**: check:structure 全部通过；相关 Jest 用例通过；GetDiagnostics 返回空数组
- **Pass Condition**: 三项检查全绿
- **Evidence**: 终端输出 + GetDiagnostics 输出
