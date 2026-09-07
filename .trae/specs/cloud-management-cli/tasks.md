# Tasks：云端管理 CLI 优化（cloud-management-cli）

**父规格路径**：`.trae/specs/cloud-management-cli/spec.md`
**代码仓库根**：`g:\Autosave\2826carplay`

## 关键设计决策（跨 Task 一致）
1. 所有脚本位置：`scripts/cloud<Name>.js`（`cloudAudit.js` / `cloudSdkCheck.js` / `cloudSdkBump.js` / `cloudNmClean.js` / `cloudNmCheck.js` / `cloudRcSync.js` / `cloudAuthAudit.js` / `cloudSpecCheck.js` / `cloudCheck.js` / `cloudHelp.js`）
2. 共享帮助函数统一放 `scripts/_cloudUtil.js`（下划线开头，jest.config 不匹配 tests 不会跑）
3. `package.json` 新增 10 条 `cloud:` 前缀 npm scripts
4. 命令解析用简易 `process.argv.slice(2)`（不装 yargs/commander，不引入新依赖）
5. 所有输出为中文 + `┌──┬──┐` 表格（`console.table` 不支持 → 手写简易表格函数）
6. exit code：`0=全通过 / 1=至少 1 项 NG / 2=参数错误`；
7. 写操作（bump / clean / rc:sync --write）前必须**显式 --write 或 --apply** 标记（默认 dry-run，防误改）

---

## Task 1：共享工具层 `_cloudUtil.js` 与 10 条 package.json scripts 挂好

- **Priority**：high
- **Dependencies**：none
- **Scope**：
  - 写 `scripts/_cloudUtil.js` 导出：
    - `PROJECT_ROOT`, `CF_ROOT` = cloudfunctions 目录
    - `listCloudfunctions()` 返回 `[{name, dir, pkgJson, pkgPath, idxPath, lines, logs, hasNm}]` 56 条（供所有 scripts 复用，统一摸排一次）
    - `printTable(rows, cols)` 简易字符串对齐表格
    - `parseArgs(argv)` 返回 `{flags: {'--write':true,'--dry':true,...}, positionals: [...]}`
    - `summarize(title, total, passed, failed)` 汇总栏
    - `runInBand(fn, list, concurrency=4)` 顺序跑（避免 spawn 56 个 npm audit 导致 Windows 进程爆炸
    - `delDirIfExists(p)` 用 `fs.rmSync(p,{recursive:true, force:true})`（安全删除）
    - 颜色：`red/green/yellow/gray` 用 `\x1b[31m/\x1b[32m/\x1b[33m/\x1b[90m`（win10+ powershell 默认开启 ANSI）
  - 改 `package.json scripts` 挂 10 条：
    ```
    "cloud:audit": "node scripts/cloudAudit.js",
    "cloud:sdk:check": "node scripts/cloudSdkCheck.js",
    "cloud:sdk:bump": "node scripts/cloudSdkBump.js",
    "cloud:nm:check": "node scripts/cloudNmCheck.js",
    "cloud:nm:clean": "node scripts/cloudNmClean.js",
    "cloud:rc:sync": "node scripts/cloudRcSync.js",
    "cloud:auth:audit": "node scripts/cloudAuthAudit.js",
    "cloud:spec:check": "node scripts/cloudSpecCheck.js",
    "cloud:check": "node scripts/cloudCheck.js",
    "cloud:help": "node scripts/cloudHelp.js"
    ```
- **Local Test Requirements**：
  - TR-T1.1（rule）：`node scripts/cloudHelp.js` 输出 10 条 `cloud:` 前缀命令，匹配 10 条
  - TR-T1.2（rule）：`require('./scripts/_cloudUtil').listCloudfunctions().length === 56`
  - TR-T1.3（rubric 0-2，≥1 pass）：工具层对外 API 是否可复用（至少 3 份其他脚本能 require 而不报错）
- **Completion Evidence**：package.json diff 段 + 10 条 scripts grep 结果 + `listCloudfunctions` 调用脚本运行 56 length

---

## Task 2：F-2/F-3 SDK 版本检查+升级（cloudSdkCheck + cloudSdkBump）

- **Priority**：high
- **Dependencies**：Task 1 完成
- **Scope**：
  - `scripts/cloudSdkCheck.js`：
    - `--target=VER` 可选（默认 4.0.2）；
    - 逐函数读 package.json 检查 `dependencies['wx-server-sdk']` 是否 === target
    - 输出表格：name | pkg.version | 状态（✅ 匹配 / ❌ 不匹配 actual）
    - exit：NG 数 > 0 → 1；0 → 0
  - `scripts/cloudSdkBump.js`：
    - 必填 `--target=VER`（无则 exit 2 + cloud:help 提示）
    - 默认 dry-run：输出 "Would change 56/56（实际 changed 0/changed N，不写文件
    - 需显式 `--write` 才真正把所有函数 package.json 写入该版本
    - 写后 exit 0 且输出 "Updated N package.json files"
- **Local Test Requirements**：
  - TR-T2.1（rule）：`npm run cloud:sdk:check -- --target=4.0.2` → exit 0 + "56/56 匹配
  - TR-T2.2（rule）：`npm run cloud:sdk:bump -- --target=4.1.0-test`（无 --write） → 0 文件 changed（dry run 不写）
  - TR-T2.3（rule）：`npm run cloud:sdk:bump -- --target=4.1.0-test --write` → Changed 56，再 `cloud:sdk:check --target=4.1.0-test` 56/56 match，然后 `cloud:sdk:bump --target=4.0.2 --write` 恢复原状，再 check 56/56 4.0.2 matched
- **Completion Evidence**：TR-T2.1-2.3 4 次命令输出全部 4 次 output 符合

---

## Task 3：F-4/F-5 node_modules 清理+检查（cloudNmCheck + cloudNmClean）

- **Priority**：high
- **Dependencies**：Task 1 完成
- **Scope**：
  - `cloudNmCheck.js`：遍历 56 个函数，hasNm 为 true 者列出；数量 N → 输出表格，N>0 exit 1，N=0 exit 0
  - `cloudNmClean.js`：
    - 默认 dry-run："Would remove 9 node_modules dirs"；
    - 必须 `--apply` 才真删除；删除前后对比，剩余残留 count=0 → exit 0
- **Local Test Requirements**：
  - TR-T3.1（rule）：`npm run cloud:nm:check` → 初始输出 9 残留且 exit>0
  - TR-T3.2（rule）：`npm run cloud:nm:clean -- --apply` 后再 `cloud:nm:check → exit 0 + 0 残留
  - TR-T3.3（rule）：9 个函数 package.json / index.js 未被误删（listCloudfunctions().length === 56）
- **Completion Evidence**：TR-T3.1-3.3 三条运行结果 + 目录不存在验证

---

## Task 4：F-6 配置目录一致性（cloudRcSync）

- **Priority**：high
- **Dependencies**：Task 1 完成
- **Scope**：
  - 读 cloudbaserc.json 中 functions[] 取出所有 `{name, timeout, memorySize, ...}` 映射（map by name
  - 读 CF_ROOT 下目录集合（实际存在
  - 默认 dry-run：
    - 输出 3 段：`MISSING_IN_RC`（目录有但 cloudbaserc 没）、`EXTRA_IN_RC`（cloudbaserc 有但目录没）、`COMMON`（二者都有）
    - 数量：Missing=0 且 Extra=0 → exit 0，否则 exit 1
  - `--write`：对 MISSING_IN_RC 每个函数按默认规格（Event, Nodejs20.19, 15s, 256MB, installDep=true, ignore ["node_modules/**"]）追加到 cloudbaserc functions[] 里，保存后重排序（按字母序保持 git diff 整洁）
- **Local Test Requirements**：
  - TR-T4.1（rule）：`npm run cloud:rc:sync -- --dry` → Missing 0, Extra 0, exit 0
  - TR-T4.2（rule）：临时改 cloudbaserc 删除 1 函数（如 vehiclePublicDetail）→ `rc:sync --dry` Missing 1，exit 1；再 `rc:sync --write` 补回后再 `rc:sync --dry` 回到 0/0
- **Completion Evidence**：TR-T4.1/4.2 前后输出 3 次运行结果

---

## Task 5：F-7 公开函数权限审计（cloudAuthAudit）

- **Priority**：medium
- **Dependencies**：Task 1 完成
- **Scope**：
  - 建立 EXPECTED_PUBLIC 白名单：`new Set(['contentGuideDetail','contentGuideList','garageVehicleList','operationConfigGet','vehiclePublicDetail'])`（与摸排一致）
  - 逐函数检查 index.js 中是否包含 AUTH_PATTERNS 任意命中：`getWXContext|OPENID|verifyAdminPermission|checkPermission|requireAdminRole`（正则）
  - 未命中 AUTH_PATTERNS 的：
    - 如果在 EXPECTED_PUBLIC → green EXPECTED
    - 否则 → red UNEXPECTED
  - 输出两张表：EXPECTED（name, 说明）+ UNEXPECTED（若有）；UNEXPECTED.length > 0 → exit 1，否则 0
- **Local Test Requirements**：
  - TR-T5.1（rule）：`npm run cloud:auth:audit` → EXPECTED 5 条全部匹配摸排 5 名称，UNEXPECTED 0，exit 0
  - TR-T5.2（rule）：临时在某函数 index.js 头部删除 所有 AUTH 标记（模拟），cloud:auth:audit → UNEXPECTED 1，exit>0，恢复后再 exit 0
- **Completion Evidence**：TR-T5.1/5.2 2 次运行 stdout

---

## Task 6：F-1 / F-8 / F-9 依赖漏洞审计 + 规格体检 + 总览（cloudAudit / cloudSpecCheck / cloudCheck）

- **Priority**：medium
- **Dependencies**：Tasks 2-5 全部完成
- **Scope**：
  - `cloudAudit.js`：
    - 串行 `child_process.execSync(`npm audit --package-lock-only --omit=dev --audit-level=critical --prefix <dir>`, {stdio: 'pipe', encoding: 'utf8'})`，逐函数运行（避免并发 56 进程导致 Windows 报错），注意：若 package-lock.json 不存在则跳过，并标记 WARN
    - 收集每函数 exit code 0=PASS / !=0=FAIL（或 --no-package-lock fallback 跳过）
    - 汇总表格：name | audit result（✅ PASS / ❌ FAIL X critical / ⚠️ NO LOCK）；汇总 PASS/FAIL/SKIP
    - exit：FAIL 数 > 0 → 1，否则 0
  - `cloudSpecCheck.js`：
    - 从 listCloudfunctions 取 lines / logs / 从 cloudbaserc 取 timeout / memorySize
    - 规格建议：`lines > 400 且 timeout=15` → WARN（建议 20s）；`logs >= 5 per fn` → INFO（建议降日志）
    - 输出：name / lines / logs / timeout(s) / memory(MB) / 建议
    - 只提醒不改写，exit 始终 0
  - `cloudCheck.js`：
    - 串行调用 5 个 check 子命令的核心函数（直接 require 各脚本导出的 `run({cli:false})`，避免 spawn 多次开销）：cloudSdkCheck / cloudNmCheck / cloudRcSync / cloudAuthAudit
    - 不跑 cloudAudit（避免 npm audit 慢），cloudSpecCheck（只输出 summary）
    - 汇总 5 条结果列总表，exit=各任务 NG 数 > 0 → 1，否则 0
- **Local Test Requirements**：
  - TR-T6.1（rule）：`npm run cloud:spec:check` → 表格行数 56 行（listCloudfunctions.length）且 exit 0
  - TR-T6.2（rule）：`npm run cloud:check` → 在 Tasks 2-5 均 exit 0 状态下 exit 0 + 输出 5/5 PASS
  - TR-T6.3（rubric 0-3；≥2 通过）：`cloudAudit.js` 是否按函数串行执行不 spawn 并行爆进程；运行时 node 任务管理器显示 Node 进程始终 ≤2（主进程 + 1 npm 子进程）
- **Completion Evidence**：TR-T6.1/6.2/6.3 3 条命令输出记录

---

## Task 7：F-10 cloudHelp + 集成测试脚本 + Jest 115 suites 回归 + 3 green 回归

- **Priority**：high
- **Dependencies**：Tasks 1-6 全部完成
- **Scope**：
  - `cloudHelp.js`：输出 10 条命令清单 + 用法示例（`--target=VER / --write / --apply / --dry` 各对应哪些命令）
  - 新增 `scripts/_cloudSmoke.js`（可选内部 smoke 测试）：一次性顺序跑 cloud:sdk:check / nm:check / rc:sync --dry / auth:audit / spec:check / help 全部 exit 0（如果 nm 未 clean 则提醒先 cloud:nm:clean --apply）
  - 回归 `npm run check:release`（Jest 115 suites + check:structure + check:secrets + drafts + check:package → 要求 100% PASS）+ GetDiagnostics=[]
- **Local Test Requirements**：
  - TR-T7.1（rule）：`npm run cloud:help` 输出内容 grep `cloud:audit` / `cloud:sdk:check` / `cloud:sdk:bump` / `cloud:nm:check` / `cloud:nm:clean` / `cloud:rc:sync` / `cloud:auth:audit` / `cloud:spec:check` / `cloud:check` / `cloud:help` 10 个字符串全部命中
  - TR-T7.2（rule）：`node scripts/_cloudSmoke.js`（若 nm clean 则） exit 0
  - TR-T7.3（rule）：`npm run check:release` → 1022 tests passed + 0 failed + GetDiagnostics []
- **Completion Evidence**：TR-T7.1/7.2/7.3 全部结果

---

## Status Summary（所有 Tasks 初始化状态）

| Task | Status | Completion Evidence |
| :--- | :----- | :------------------ |
| T1：共享工具层 + scripts 接入 | pending | |
| T2：SDK 版本 check/bump | pending | |
| T3：node_modules check/clean | pending | |
| T4：rc:sync 目录×配置双向 | pending | |
| T5：auth:audit 权限审计 | pending | |
| T6：audit/specCheck/cloudCheck 聚合 | pending | |
| T7：help + 集成 Jest 回归 | pending | |
