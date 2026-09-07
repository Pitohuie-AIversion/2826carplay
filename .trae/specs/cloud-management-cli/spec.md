# 规格：云端管理 CLI 优化

## 1. Problem
当前项目 `2826carplay` 是 56 个微信原生小程序云函数 + 13 个后台管理分包页（pages-admin），已完成小程序侧 100% Jest 通过，但"云端的管理"**没有任何统一的命令行接口（CLI）自动化能力。开发人员在以下 6 个日常场景必须手动进入微信云开发控制台或逐个翻文件查找才能运维：

1. **H1 依赖/环境一致性：`package.json scripts` 目前 `audit:cloud` 只对 `bookingCreate` 一个函数跑 `npm audit`，剩余 55 个函数无法在发布前做依赖漏洞审计 + 统一 wx-server-sdk 版本升级；
2. **H2 打包规范对齐：56 个 `cloudfunctions/<name>/package.json` 的 wx-server-sdk 版本必须全部 4.0.2，但没有 CLI 验证一致性，无法一键改到新版本并核对；
3. **H3 云函数 node_modules 残留：实测 9 个函数下残留本地 node_modules（bookingCancel/bookingCreate/bookingExportCsv/bookingList/bookingMyList/bookingUpdateStatus/bookingUpdateAdminRemark/vehicleDelete/vehicleImageUpdate）—— 即使 cloudbaserc ignore `node_modules/**` 忽略了，也会占用本地磁盘空间和 git status 噪音；
4. **H4 配置-目录对齐：`cloudbaserc.json functions 56 条手写，新增一个函数必须两处改动（目录 + cloudbaserc），容易漏；也无法在本地核对 "56 vs 56" 的一致性；
5. **H5 公网公开函数审计：5 个"无 OPENID/权限校验"的云函数（contentGuideDetail/contentGuideList/garageVehicleList/operationConfigGet/vehiclePublicDetail）当前只是摸排出来的，无法一键复核是否真的"公开读无害"或"隐式通过安全"；
6. **H6 规格（规格合理：56 函数 49 个 15s/256MB + 7 个 20s/256MB 一刀切，无法一键显示 "哪个函数可能需要 right-size（如 garageVehicleList 594 行 5 个 console.log 可能更吃内存）。

## 2. Users
- **运维/开发：极境车库项目开发者（CLI 执行脚本作者自己）
- **Code Owner：@carplay-2826 团队代码所有者

## 3. Goals
在不引入任何 npm 新依赖（只用 node + 现有 Jest、wx-server-sdk 4.0.2、cloudbaserc 配置）的前提下，将 100% 原生 Node.js `node scripts/xxx.js + package.json `npm run cloud:*` 命令，覆盖 6 大类云端管理日常，使云端管理日常 CLI 化；所有命令必须 exit 0=pass / >0=fail，可用于本机跑，可接入 CI（可选）。

## 4. Non-Goals
- 不引入 CloudBase Framework，不执行真实云端任何写操作（如 tcb fn deploy，只做本地审计和生成 diff，执行云端调用 wx.cloud.callFunction 这类运行测试不在本次范围）；
- 不修改 cloudfunctions/*/index.js 业务逻辑（只读审计，不改权限/规格，如发现问题只给出建议，不在本 spec 不解决问题只提供 CLI 命令发现）；
- 不引入 `wx cloud cli 工具依赖；
- 不改造现有的 Jest suite 改动，即 115 suites / 1022 tests 继续 100% 保持；
- 不做云函数版本管理、灰度发布、日志抓取等跨环境发布运维（spec 不做 UI，只做 CLI）。

## 5. Functional Requirements（Functional）

| ID   | 功能模块                | 能力（FR）                                                                                               |
| :--- | :---------------------- | :------------------------------------------------------------------------------------------------------- |
| F-1  | 依赖漏洞审计（56 全覆盖 | `npm run cloud:audit` 对 56 个云函数逐个执行 `npm audit --package-lock-only --omit=dev --audit-level=critical`，汇总 OK（OK 输出 N passed / M failed，逐个函数名） |
| F-2  | SDK 版本一致性         | `npm run cloud:sdk:check` 检查 56 个函数 `package.json` 的 `wx-server-sdk` 是否全部等于目标版本（默认 `4.0.2`，可 `--target 4.1.0` 覆盖）；不一致者列出并退出>0 |
| F-3  | SDK 版本一键升级       | `npm run cloud:sdk:bump -- --target=<ver` 将 56 个函数的 package.json 的 wx-server-sdk 版本号批量改，改完输出 changed list |
| F-4  | node_modules 清理      | `npm run cloud:nm:clean` 删除 所有 `cloudfunctions/*/node_modules 目录（只删目录，不删 package.json/lock），删前输出要删的列表，删后对比前后数量 |
| F-5  | nm 存在性检查          | `npm run cloud:nm:check` 检查 56 个云函数下是否存在 node_modules 残留，存在则 exit>0 + 列出 9 个残留名（用于 CI gate） |
| F-6  | 配置-目录双向一致性    | `npm run cloud:rc:sync -- --dry` 核对 cloudbaserc functions 条目数 vs cloudfunctions 目录数，列出 missing/extra；`--write` 从目录反写 cloudbaserc（默认规格：缺失条目=Event、Nodejs20.19、256MB、15s、installDep=true、ignore node_modules/**），双向均正确=pass |
| F-7  | 公开函数权限审计       | `npm run cloud:auth:audit` 列出 index.js 不含 getWXContext / OPENID / verifyAdminPermission / checkPermission 的函数，分为 3 层输出：EXPECTED_PUBLIC（contentGuide*/garageVehicleList/operationConfigGet/vehiclePublicDetail）标记 green + UNEXPECTED_PUBLIC（不在白名单但是无校验，exit>0） |
| F-8  | 云函数规格体检         | `npm run cloud:spec:check` 输出 56 函数规格表格（name / lines / logs / timeout / memory / 是否符合规格建议），对超 400 行以上仍 15s 给 warning，不改写；exit 0 |
| F-9  | 管理全景汇总             | `npm run cloud:check` 一键串行 F1/F2/F5/F6/F7 全部 pass 汇总 5 条，汇总 OK 退出 0，有 1 条 NG 退出 1（类似 check:release 逻辑，可加入 `check:release 不自动串联，保持原 release 检查不变（可选：默认 cloud:check 独立） |
| F-10 | CLI 帮助/帮助         | `npm run cloud:help` 输出 10 个命令清单（所有命令 + -- 可选参数）                                                         |

## 6. Non-Functional Requirements

| ID  | 类型          | 详情                                                                                                         |
| :-- | :---------- | :----------------------------------------------------------------------------------------------------------- |
| NF-1 | 零新依赖    | 不安装任何 node_modules，脚本仅依赖 node 原生 + Jest 的已有模块：只用 npm 自带（shell 跑 npm/）                                                    |
| NF-2 | 可重复幂等    | F-3 bump / F-4 clean / F-6 sync 必须幂等（重复跑不产生 diff |
| NF-3 | 路径跨平台    | 所有 path.resolve + 递归删除使用 rimraf 等价的原生 fs.rmSync recursive，使用 process.cwd() 不硬编码，Windows/Mac/Linux OK |
| NF-4 | 零回归      | 实现 F-1/F-2/F-5/F-6/F-7/F-8 任一命令不对文件产生写入副作用（除 F-3/F-4/F-6 --write 显式写）                |
| NF-5 | 中文输出    | 所有命令 exit 中文 stdout 列，标题 ── 颜色分隔 + 最终 N passed / M failed 汇总                                |

## 7. Constraints / Dependencies / Assumptions / Open Questions

### 7.1 Constraints
- 项目根目录 `g:\Autosave\2826carplay，cloudfunctions 为实际存在，envId 云环境 cloud1-d8gtmns36320e045e
- 所有命令不得修改 pages/* pages-admin/* 任何共享模块（除非 tasks.md 中若对 page.js，不在此次 scope 之外）
- 不修改 `cloudfunctions/*/index.js / package.json 除了 sdk:bump（F-3）显式指定才写，其余均只读审计

### 7.2 Dependencies
- `cloudbaserc.json` 现有 56 functions 定义作为基准（F-6 读取）
- 56 个 `cloudfunctions/*/package.json` 全部存在（摸排 56 全有）
- `wx-server-sdk 4.0.2 当前全一致（摸排结果：100%）

### 7.3 Assumptions
- 用户"CLI"=项目根 package.json 下的 `npm run cloud:<sub>`（非云平台部署 CLI 工具调用，本地调用）
- 所有脚本位于 `scripts/cloud*.js` 新文件目录中（与 scripts/checkProjectStructure.js 并列

### 7.4 Open Questions
- OQ-1 `cloud:rc:sync --write 默认规格（15s/256MB/Nodejs20.19）是否合适？—— 默认使用摸排 49/56=87.5% 采用此规格，所以默认 OK，自定义可通过 CLOUD_DEFAULT_TIMEOUT/CLOUD_DEFAULT_MEM 覆盖；本假设按此
- OQ-2 cloud:audit 是否支持 --function=<name> 只跑单个？—— Spec 中，不做（FR 不强制，可选实现 tasks 阶段加个 -- 解析即可如方便排查但不进 AC

## 8. Acceptance Criteria（Type: rule / rubric

| ID     | 类型   | 规则/细则                                                                                                                      | 证据来源                                    |
| :----- | :----- | :-------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- |
| AC-1   | rule   | `node scripts/cloudAudit.js`（或等价 cloud:audit）运行结果含 `"56 passed / 0 failed"（实际因可能 fail 漏洞>0 exit>0 exit code=0；1-56 任意输出结果列名正确  | 命令 stdout 中文字输出 stdout 逐列                                                              |
| AC-2   | rule   | `cloud:sdk:check --target=4.0.2` exit 0 + stdout "56/56 匹配 | 运行输出 + exit code                   |
| AC-3   | rule   | `cloud:sdk:bump --target=4.1.0-test`（dry 运行为"56 package.json changed，然后 bump 后"wx-server-sdk 变为 4.1.0-test，再 bump 回 4.0.2，restore：F-3 幂等 | fs 读 前后对比；exit 56*2 diff 56 matched | 运行 + git diff（测试用临时版本 4.0.2 后恢复 |
| AC-4   | rule   | `cloud:nm:check`摸排初始摸排 9 个残留 exit>0，执行`cloud:nm:clean`后再跑 exit 0 | 两次运行 + 对比 前后                |
| AC-5   | rule   | `cloud:rc:sync --dry 输出 "配置 56 条 =56 目录 56 missing 0 extra 0 exit 0 | 运行输出                           |
| AC-6   | rule   | `cloud:auth:audit` 输出 EXPECTED_PUBLIC 5 个白名单名称与摸排 5 个实际匹配，UNEXPECTED_PUBLIC 0 → exit 0 | 运行 stdout 白名单列表内容                 |
| AC-7   | rubric | 云端管理 CLI 整体体验（0-3）：≥ 3 = ≥7 command 能 npm run cloud:** 一次执行无需改文件 ≤ 7 全部找到；2 = ≤ 5，<3=0 仅 2 条 | 人工审查；通过阈值 ≥ 2      |
| AC-8   | rule   | `npm run check:release` 115 suites / 1022 tests 100% PASS 0 failures + 0 diagnostics | Jest/diagnostics             |
| AC-9   | rule   | `cloud:spec:check` 输出表格 56 行，每行 lines/logs/timeout/memory/ 字段齐全 | stdout                         |
| AC-10  | rule   | `cloud:help` 列出 10 条命令名全部列出（F-1~F-10） | stdout grep 匹配 10 个 `cloud:` 前缀 |
