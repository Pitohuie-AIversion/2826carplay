# 极境车库开发文档中心 (Documentation Hub)

欢迎查阅极境车库（2826CarPlay）微信小程序与腾讯云开发（CloudBase）完整技术文档。本文档中心旨在为开发者、测试人员与架构维护者提供统一、结构化、易于检索的技术指引与标准规范。

---

## 快速导航 (Documentation Index)

```
docs/
├── README.md                  # 本文档中心入口与全景导航
├── API_REFERENCE.md           # 共享核心架构库 (shared/) 完整 API 规范与使用手册
├── DEVELOPMENT_GUIDE.md       # 本地开发、环境搭建、行为守卫与自动化回归指南
└── DATABASE_AND_SECURITY.md   # 云数据库 16 个核心集合模型、52 项复合索引与安全规则
```

### 根目录核心架构与规范文档

| 文档名称 | 核心定位与职责 |
| :--- | :--- |
| [ARCHITECTURE.md](file:///g:/Autosave/2826carplay/ARCHITECTURE.md) | **系统架构设计总览**：4 层高内聚分层架构、模块边界、4 项工程守卫与扩展开发范式。 |
| [AGENTS.md](file:///g:/Autosave/2826carplay/AGENTS.md) | **AI Agent 与团队行为准则**：内存同步优先、生命周期销毁、原生动作保护与包体积预算。 |
| [DEVELOPMENT_ROADMAP.md](file:///g:/Autosave/2826carplay/DEVELOPMENT_ROADMAP.md) | **阶段演进路线图**：Phase 0 至 Phase 17 详细功能定义、阶段边界与交易能力决策门。 |
| [DEPLOY_CHECKLIST.md](file:///g:/Autosave/2826carplay/DEPLOY_CHECKLIST.md) | **生产上线部署清单**：56 个云函数、云环境配置、备份、权限初始化与发布前核对。 |
| [PHASE16_DEPLOY_AND_ACCEPTANCE.md](file:///g:/Autosave/2826carplay/PHASE16_DEPLOY_AND_ACCEPTANCE.md) | **阶段验收标准**：内容增长、场景指南与渠道归因云端验收与真机核验规范。 |

---

## 系统全景概览

### 1. 技术栈与运行环境
- **客户端**：微信原生小程序（WXML / WXSS / JavaScript / JSON），分包架构（主包 + `pages-admin` 独立分包）。
- **服务端**：腾讯云开发 CloudBase Serverless，56 个单职责轻量云函数，运行于 `Node.js 20.19`（固定 `wx-server-sdk@4.0.2`）。
- **存储与数据**：CloudBase NoSQL 数据库（16 个集合，52 项复合索引，严格集合安全规则），云存储（车辆图库、留证照片、安全报表）。
- **自动化测试基线**：**154 个 Jest 测试套件，1841 项用例 100% 通过**；**333 项无头交互点击仿真 100% 通过**；**0 条日志/断点残留**。
- **包体积控制**：主包真实体积 **1.24 MiB**，严守 **1.75 MiB** 安全预警水位线（留有 **0.76 MiB** 充裕余量）。

---

## 核心开发工作流与常用命令

```bash
# 1. 运行完整自动化测试套件 (154 suites / 1841 tests)
npm test

# 2. 运行上线前全项综合体检 (结构、密钥、草稿、索引、包体积、单线程单元测试)
npm run check:release

# 3. 运行全页面 333 项无头组件与交互点击仿真
npm run simulate:clicks

# 4. 实时校验小程序主包与分包体积预算
npm run check:package

# 5. 校验数据库 52 项复合索引配置
npm run check:indexes

# 6. 云函数审计与依赖一致性体检
npm run cloud:audit
```

---

## 开发者快速上手三步走

1. **阅读准则**：在编写或重构任何代码前，必须完整阅读 [AGENTS.md](file:///g:/Autosave/2826carplay/AGENTS.md) 了解**时序守卫**与**资源泄露防范**。
2. **掌握架构**：阅读 [ARCHITECTURE.md](file:///g:/Autosave/2826carplay/ARCHITECTURE.md) 与 [docs/API_REFERENCE.md](file:///g:/Autosave/2826carplay/docs/API_REFERENCE.md)，使用 `definePage`、`callCloud` 与 `dateUtils` 统一抽象开发新页面或调用云端。
3. **提交前体检**：每次修改完成后，按顺序运行 `npm run check:release` 与 `npm run simulate:clicks`，确保 100% 通过且主包体积低于 1.75 MiB。
