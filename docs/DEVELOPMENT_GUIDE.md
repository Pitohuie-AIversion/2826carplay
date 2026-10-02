# 极境车库开发与工程维护指南 (Development Guide)

本文档面向所有参与极境车库（2826CarPlay）小程序前端、云函数与架构维护的工程师与 Agent，详细说明开发环境搭建、开发规范、核心守卫及全量自动化体检体系。

---

## 一、 环境依赖与准备

### 1.1 基础环境
- **Node.js**: `>= 18.0.0`（推荐 `20.19.0`，与生产环境 CloudBase 云函数运行时保持完全对齐）。
- **微信开发者工具**: 最新 Stable 版本。导入项目时设置：
  - 项目根目录：`2826carplay/`
  - 云开发环境 ID：`cloud1-d8gtmns36320e045e`
  - 调试基础库：`>= 3.0.0`
- **依赖安装**:
  ```bash
  npm install
  ```

---

## 二、 核心架构守卫准则 (Guardrails)

在编写、重构或调试业务代码时，必须严格遵守以下准则：

### 2.1 状态与时序守卫 (State & Timing Guardrails)
- **内存同步优先**：调用状态批处理函数 `applyState` 时，**必须在当前同步微任务内立即更新 `this.data`**，然后再推入 `wx.nextTick` 渲染队列。杜绝“渲染被延迟排期、而内存数据尚未同步更新”的时序差。
- **搜索输入完整闭环**：所有声明了 `confirm-type="search"` 的 `<input>`，必须在 WXML 中同时绑定 `bindinput` 与 `bindconfirm="handleSearchConfirm"`，并在 JS 中实现对应的回车立即检索逻辑，取消防抖并立即响应移动端软键盘“搜索”按键。
- **请求参数显式透传**：在处理列表筛选、排序、城市切换或清空重置等交互时，`fetchList(input)` 等数据请求方法必须支持并优先接收显式参数字典（如 `{ status, keyword, sortBy, city }`），直接将最新参数显式透传给请求，消灭由异步排期可能引起的参数状态偏差。

### 2.2 异步生命周期与资源泄露防范 (Lifecycle & Teardown Guardrails)
- **主动销毁所有定时与事件句柄**：在页面的 `onLoad` 或组件中创建的防抖器 (`debounce`)、延迟定时器 (`setTimeout`)、轮询器 (`setInterval`)、网络重连监听 (`onNetworkReconnect`)，必须在 `onUnload` 中进行完整的 `cancel()` 或 `dispose()`，防止页面卸载后后台工作进程泄漏。
- **原生动作切页保护**：对于微信系统级异步动作（如拨打电话 `wx.makePhoneCall`、拉起操作菜单 `wx.showActionSheet`、图片选择 `wx.chooseMedia`），在异步回调中执行 `this.setData` 或状态联动前，必须通过 `pageNativeAction` 校验当前页面实例是否依然在栈顶且未被卸载（`isPageNativeActionActive`），严防跨页面脏写入或在后台页面触发异常弹窗。

### 2.3 代码发布合规性 (Release Hygiene)
- **零日志输出与调试断点**：业务代码（`pages/`、`pages-admin/`、`shared/`、`cloudfunctions/`）中**严禁残留任何 `console.log`、`console.info`、`console.debug` 或 `debugger` 语句**。上线前运行 `__tests__/releaseHygiene.test.js` 实行一票否决制。

### 2.4 包体积与性能预算 (Package Footprint Budget)
- **严守 1.75 MiB 安全预警水位线**：微信主包硬性上限为 2.0 MiB，本项目设定 1.75 MiB 安全警戒线。
- **管理端独立分包**：所有管理端页面与资源统一收敛至 `pages-admin` 独立分包（当前约为 0.66 MiB），主包体积稳定保持在 **1.24 MiB**（留有 **0.76 MiB** 充裕余量）。
- 严禁向主包引入未经压缩的大于 100 KB 的位图资源或冗余外部依赖。

---

## 三、 云函数同步与开发关键陷阱 (Critical Gotchas)

### 3.1 跨端同构文件字节级同步
- 在 `shared/` 目录下部分与云端共享的业务计算文件（如 `shared/rentalPricing.js`），与各云函数目录（如 `cloudfunctions/bookingCreate/rentalPricing.js`）存在字节级对齐校验测试（`fs.readFileSync` 严格相等）。
- **规则**：若修改了此类共享文件，必须同步更新所有对应云函数包中的对应文件；对于纯小程序端展示的枚举和文案，建议收敛在 [shared/vehicleLabels.js](file:///g:/Autosave/2826carplay/shared/vehicleLabels.js) 与 [shared/bookingStatus.js](file:///g:/Autosave/2826carplay/shared/bookingStatus.js) 中，避免破坏云函数字节同步。

### 3.2 运行时与 SDK 锁文件
- 56 个云函数本地目标运行时统一为 `Node.js 20.19`，固定依赖 `wx-server-sdk@4.0.2`，每个函数目录下均包含独立的 `package.json` 与 `package-lock.json`，严禁使用浮动版本（`^`、`~`）。

---

## 四、 自动化体检与测试工作流

在每次功能开发、缺陷修复或架构重构完成后，必须按顺序执行以下命令进行闭环验证：

### 4.1 全链路工程质量总门禁 (Quality Gate & Doctor)
```bash
# 执行全量 8 阶段工业级深度体检（规范、安全、草稿、索引、包体积、单测、点击仿真、业务旅程）
npm run doctor             # 或 node scripts/qualityGate.js

# 快捷静态质量扫描（前 5 阶段：秒级完成）
npm run quality:fast       # 或 node scripts/qualityGate.js --static
```

### 4.2 单元与集成测试 (Jest)
```bash
# 执行全部 154 个测试套件 (1855 个测试用例 100% 通过)
npm test

# 针对特定模块运行单测
npx jest __tests__/architecture.test.js
npx jest __tests__/bookingStatus.test.js
npx jest __tests__/releaseHygiene.test.js
```

### 4.3 全页面无头点击仿真 (Headless Simulation)
```bash
# 模拟执行全量 26 个页面与组件的 333 项真实交互点击断言
npm run simulate:clicks

# 执行 30 项真实用户端到端核心业务旅程仿真
node scripts/verifyActualUsage.js
```

### 4.4 小程序体积与安全预算审计
```bash
# 检查真实主包与分包体积（主包 1.23 MiB，余量 0.77 MiB）
npm run check:package

# 检查代码库是否误存敏感凭据或密钥
npm run check:secrets

# 检查 16 个云数据库集合的 52 项复合索引配置
npm run check:indexes
```

### 4.5 上线前一键全流程综合验收
```bash
npm run check:release
```
该命令会自动串联执行：
1. `check:structure` (页面路由与云函数目录完整性)
2. `check:secrets` (无硬编码密钥与敏感凭证)
3. `check:drafts` (营销场景与指南校验)
4. `check:indexes` (52 项复合数据库索引完整性)
5. `check:package` (主包体积严格在安全阈值以下)
6. `npm test -- --runInBand` (全量 Jest 回归用例单线程执行)
