# 爱迦租车开发文档中心 (Documentation Hub)

欢迎查阅爱迦租车（2826CarPlay）微信小程序与腾讯云开发（CloudBase）完整技术文档。本文档中心旨在为开发者、测试人员与架构维护者提供统一、结构化、易于检索的技术指引与标准规范。

---

## 快速导航 (Documentation Index)

```
docs/
├── README.md                  # 本文档中心入口与全景导航
├── API_REFERENCE.md           # 共享核心架构库 (shared/) 完整 API 规范与使用手册
├── DEVELOPMENT_GUIDE.md       # 本地开发、环境搭建、行为守卫与自动化回归指南
├── DATABASE_AND_SECURITY.md   # 17 个集合、11 条显式索引声明与安全规则
├── INTERNET_REVIEW_2026-10-25.md # 官方资料对照检查与整改记录
└── CHECKLIST.md               # 小程序发版上线全要素核对与灰度发布清单
```

### 根目录核心架构与规范文档

| 文档名称 | 核心定位与职责 |
| :--- | :--- |
| [ARCHITECTURE.md](file:///g:/Autosave/2826carplay/ARCHITECTURE.md) | **系统架构设计总览**：4 层高内聚分层架构、模块边界、4 项工程守卫与扩展开发范式。 |
| [CONTRIBUTING.md](file:///g:/Autosave/2826carplay/CONTRIBUTING.md) | **工程贡献与协同准则**：Git Flow 分支策略、Conventional Commits、4 项守卫与门禁评分。 |
| [AGENTS.md](file:///g:/Autosave/2826carplay/AGENTS.md) | **AI Agent 与团队行为准则**：内存同步优先、生命周期销毁、原生动作保护与包体积预算。 |
| [DEVELOPMENT_ROADMAP.md](file:///g:/Autosave/2826carplay/DEVELOPMENT_ROADMAP.md) | **阶段演进路线图**：Phase 0 至 Phase 17 详细功能定义、阶段边界与交易能力决策门。 |
| [DEPLOY_CHECKLIST.md](../DEPLOY_CHECKLIST.md) | **生产上线部署清单**：57 个云函数、本地目标与线上实际值、备份、权限初始化与发布前核对。 |
| [PHASE16_DEPLOY_AND_ACCEPTANCE.md](file:///g:/Autosave/2826carplay/PHASE16_DEPLOY_AND_ACCEPTANCE.md) | **阶段验收标准**：内容增长、场景指南与渠道归因云端验收与真机核验规范。 |

---

## 系统全景概览

### 1. 技术栈与运行环境
- **客户端**：微信原生小程序（WXML / WXSS / JavaScript / JSON），分包架构（主包 + `pages-admin` 独立分包）。
- **服务端**：腾讯云开发 CloudBase Serverless，57 个云函数，本地部署目标 `Nodejs24.11`，固定 `wx-server-sdk@4.0.2`。目标版本不代表实际线上版本；迁移与回读要求见部署清单。
- **存储与数据**：清单声明 17 个集合和 12 条索引，均禁止客户端直接读写。车辆图片公开读取；图片写入由 `adminImageUpload` 鉴权、分块、校验后完成。集合与规则需在云端单独应用。
- **自动化测试与体积**：以 [项目 README](../README.md) 和 [本轮整改记录](INTERNET_REVIEW_2026-10-25.md) 的带日期结果为准；主包警戒线为 **1.75 MiB**，硬上限 **2 MiB**。本地仿真不替代真机和真实云环境验收。

---

## 核心开发工作流与常用命令

```bash
# 1. 运行一键工程质量总门禁（9 阶段，含云函数与运行时检查）
npm run doctor             # 或 node scripts/qualityGate.js
npm run quality:fast       # 快捷静态门禁（前 6 阶段）

# 2. 运行完整自动化测试套件
npm test

# 3. 运行上线前全项综合体检
npm run check:release

# 4. 运行全页面无头组件与交互点击仿真
npm run simulate:clicks

# 5. 实时校验小程序主包与分包体积预算
npm run check:package

# 6. 校验数据库集合覆盖与索引声明
npm run check:indexes

# 7. 校验本地目标运行时是否已结束上游维护
npm run cloud:runtime:check
```

---

## 开发者快速上手三步走

1. **阅读准则**：在编写或重构任何代码前，必须完整阅读 [AGENTS.md](file:///g:/Autosave/2826carplay/AGENTS.md) 了解**时序守卫**与**资源泄露防范**。
2. **掌握架构**：阅读 [ARCHITECTURE.md](file:///g:/Autosave/2826carplay/ARCHITECTURE.md) 与 [docs/API_REFERENCE.md](file:///g:/Autosave/2826carplay/docs/API_REFERENCE.md)，使用 `definePage`、`callCloud` 与 `dateUtils` 统一抽象开发新页面或调用云端。
3. **提交前体检**：每次修改完成后，按顺序运行 `npm run check:release` 与 `npm run simulate:clicks`，确保 100% 通过且主包体积低于 1.75 MiB。
