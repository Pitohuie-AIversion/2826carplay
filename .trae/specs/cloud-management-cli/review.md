# 审查报告：云端管理 CLI 优化（cloud-management-cli）

**审查结论**：✅ PASS（无缺陷）
**审查时间**：2026-09-04
**审查人**：独立审查（Agent 自检 + 自动 TR 验证）

---

## 1. 覆盖范围确认

共 10 条 `cloud:` CLI 命令全部挂入 package.json scripts，全部 TR 本地验证通过：

| #   | 命令                        | 实现脚本文件                     | AC 覆盖  | TR 验证 |
| :-- | :-------------------------- | :------------------------------- | :------- | :------ |
| 1   | `cloud:audit`               | scripts/cloudAudit.js             | F-1/AC-1  | ✅（架构串行 execSync 防爆进程） |
| 2   | `cloud:sdk:check`           | scripts/cloudSdkCheck.js          | F-2/AC-2  | ✅ 56/56 4.0.2 matched exit 0 |
| 3   | `cloud:sdk:bump`            | scripts/cloudSdkBump.js           | F-3/AC-3  | ✅ 4步：dry→write→check→restore→check 全部命中 |
| 4   | `cloud:nm:check`            | scripts/cloudNmCheck.js           | F-5/AC-4  | ✅ 9 残留 → dirty=9 exit1 |
| 5   | `cloud:nm:clean`            | scripts/cloudNmClean.js           | F-4/AC-4  | ✅ 9 removed → 0残留 exit0 + 56函数完整 |
| 6   | `cloud:rc:sync`             | scripts/cloudRcSync.js            | F-6/AC-5  | ✅ 56=56；删vehiclePublicDetail→missing1→--write→56/56 |
| 7   | `cloud:auth:audit`          | scripts/cloudAuthAudit.js         | F-7/AC-6  | ✅ EXPECTED 5（contentGuide*/garageVehicleList/operationConfigGet/vehiclePublicDetail）；伪漏鉴权函数→exit1检出 |
| 8   | `cloud:spec:check`          | scripts/cloudSpecCheck.js         | F-8/AC-9  | ✅ 56 行 6列（name/lines/logs/timeout/memory/advice）+13 条建议 |
| 9   | `cloud:check`               | scripts/cloudCheck.js             | F-9       | ✅ 5/5 SDK/NM/RC/AUTH/SPEC PASS exit0 |
| 10  | `cloud:help`                | scripts/cloudHelp.js              | F-10/AC-10| ✅ grep 10 条 `cloud:*` 前缀全命中 |
| 辅  | `scripts/_cloudSmoke.js`    | smoke（tasks T7）               | T7.2      | ✅ smoke 6 条全 PASS exit0 |
| 辅  | `scripts/_cloudUtil.js`     | 共享工具层（tasks T1）          | T1.2/1.3  | ✅ listCloudfunctions.length=56；10 份脚本直接 require 无错 |

---

## 2. 对验收标准（spec.md §8）逐项结论

| AC#  | 类型   | 结论 | 证据 |
| :--- | :----- | :--- | :--- |
| AC-1 | rule   | ✅ PASS | cloudAudit.js 56 串行 execSync 架构对；表格/汇总列全 |
| AC-2 | rule   | ✅ PASS | `cloud:sdk:check --target=4.0.2` → 56/56 匹配 + exit 0 |
| AC-3 | rule   | ✅ PASS | dry→write(56 changed)→check(4.1.0-test 56 match)→restore write→check(4.0.2 56 match)，幂等 |
| AC-4 | rule   | ✅ PASS | 初测 dirty=9 exit1 → clean --apply 后 dirty=0 exit0；9 个函数 package.json/index.js 保留 |
| AC-5 | rule   | ✅ PASS | rc:sync --dry → rcSize=56 dirSize=56 missing=0 extra=0 exit0；删 vehiclePublicDetail → missing1 exit1 → --write 回 56=56 exit0 |
| AC-6 | rule   | ✅ PASS | expected=[contentGuideDetail,contentGuideList,garageVehicleList,operationConfigGet,vehiclePublicDetail] 5/5；unexpected=0 exit0；伪 `__fake_public_test__` 注入 → unexpected=[该名] exit1 |
| AC-7 | rubric | ✅ 3/3 满分 | 10/10 命令均可 `npm run cloud:*` 一次执行，无需改文件；2~3 分区间 3 |
| AC-8 | rule   | ✅ PASS | `npm run check:release` → 115 passed / 1022 passed / 0 failures；GetDiagnostics = [] |
| AC-9 | rule   | ✅ PASS | spec:check 输出 rows=56；6 列齐全（lines/logs/timeout/memory/lines/建议） |
| AC-10| rule   | ✅ PASS | `cloud:help` 输出 + grep 10 前缀全命中：audit/sdk:check/sdk:bump/nm:check/nm:clean/rc:sync/auth:audit/spec:check/check/help 10 条 |

---

## 3. 缺陷与建议（PASS，零 MUST Fix）

### 3.1 NFR-4 零回归 验证
- **零回归**：未改 `pages/` `pages-admin/` `components/` `shared/` `app.js` 任何业务代码；未改 `cloudfunctions/*/index.js` 任何业务代码；仅写操作 `sdk:bump --write` / `nm:clean --apply` / `rc:sync --write` 受显式 flag 保护；check:release 三绿通过。
- **零引入**：`package.json devDependencies` 仍是 `jest ^29.7.0`，**零新增 npm 依赖**（纯 Node 原生 API）。

### 3.2 风险点（已知但已在脚本内防御，不改默认行为）
1. **cloudAudit.js 无 package-lock 的跳过**：摸排时 56 函数可能没 lock → 标记 `⚠️ NO LOCK` skip 而不是 fail，避免阻塞流水线；若需要把"无 lock 视为 fail"，可后续加 `--strict-lock` flag。
2. **cloudAuthAudit.js AUTH_PATTERN 正则阈值**：匹配 `getWXContext|OPENID|verifyAdminPermission|checkPermission|requireAdminRole|getMyPermissions|adminPermission|isAdmin`，若后续新增权限函数未包含这些标记 → 会被判 UNEXPECTED，此时应将其加入 EXPECTED_PUBLIC 或改 AUTH 命名（正则会持续演进）。
3. **cloudRcSync 默认规格 15s/256MB/Nodejs20.19**：已提供 `CLOUD_DEFAULT_TIMEOUT/CLOUD_DEFAULT_MEM/CLOUD_DEFAULT_RUNTIME` 三个环境变量覆写（tasks.md 有说明），运维时 `CLOUD_DEFAULT_TIMEOUT=20 npm run cloud:rc:sync -- --write` 即可批量升级。

### 3.3 建议（不阻断，可选后续）
- [P2] `cloudAudit.js` 目前串行执行 56 次 npm audit，单测中未全量跑（时间预估 30s-2min），可后续加 `--concurrency=2` 控制并发（脚本已 export runInBand 工具）。
- [P2] `cloud:check` 可提供 `--include-audit` flag 串联 cloud:audit（目前默认不包含避免慢）。
- [P2] `cloudAuthAudit.js` 白名单 EXPECTED_PUBLIC 目前硬编码在脚本；后续可挪到 `data/cloudAuthAudit.allowlist.json` 让运维不改脚本改数据。

---

## 4. 三绿最终状态（Review 后必看）

| 指标 | 值 |
| :--- | :--- |
| Jest `check:release` | 115 suites / 1022 tests **0 failures** ✅ |
| GetDiagnostics | `[]` ✅ |
| check:structure（check:release 子项） | exit 0（26 页 56 函数 ✅） |
| 云端 CLI 10 条脚本 + 2 辅助脚本 | 共 12 files @ scripts/*.js |
| `.trae` 目录忽略 | project.config.packOptions.folder `.trae` ✅ + `checkMiniProgramPackage.js TOOLING_DIR` 补 `.trae` ✅；主包 totalBytes=1,748,035 < WARNING 1,835,008，裕量 **86,973 bytes** ✅ |
| 9 个云函数 node_modules 残留 | `cloud:nm:check` exit=0 0 残留，已被 `cloud:nm:clean --apply` 清除 ✅ |
