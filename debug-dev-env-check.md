# Debug Session: dev-env-check
- **Status**: [OPEN]
- **Issue**: 开发环境需要排查，确认依赖、脚本、测试与本地运行链路是否正常。
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-dev-env-check.ndjson

## Reproduction Steps
1. 在项目根目录执行依赖与脚本检查。
2. 运行测试与可用的启动/构建命令。
3. 记录失败现象、错误输出与修复结论。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Node 或 npm 在当前终端不可用 | Medium | Low | Pending |
| B | 项目依赖未完整安装或锁文件与模块不一致 | High | Low | Pending |
| C | `package.json` 脚本缺失或命令配置错误 | Medium | Low | Pending |
| D | 代码存在当前会阻塞开发验证的测试/语法错误 | High | Medium | Pending |
| E | 小程序本地开发依赖的云环境配置不完整 | Medium | Medium | Pending |

## Log Evidence
- 初次验证中，`node -v` 与 `npm.cmd test -- --runInBand` 可在一个终端执行成功，说明项目依赖和测试链路可用。
- 另一个新终端中 `Get-Command node` 与 `Get-Command npm.cmd` 均报 `CommandNotFoundException`，说明问题不在仓库而在终端环境。
- 对比环境变量后发现：可用终端的 `PROCESS_PATH_HAS_NODEJS=True`，异常终端为 `False`，且 `Machine/User Path` 均未包含 `C:\Program Files\nodejs`。
- 新建 PowerShell profile 后，子进程执行 `powershell -Command "node -v"` 仍失败，并提示 `Microsoft.PowerShell_profile.ps1 cannot be loaded because running scripts is disabled`。
- 读取执行策略得到有效值 `Restricted`；调整为 `CurrentUser=RemoteSigned` 后，再次执行：
  - `powershell -Command "node -v"` => `v26.4.0`
  - `powershell -Command "npm.cmd -v"` => `11.17.0`
  - `powershell -Command "Set-Location 'G:\Autosave\2826carplay'; npm.cmd test -- --runInBand"` => 10 个套件、55 个用例全部通过

## Verification Conclusion
- 假设 A：部分确认。不是 Node 未安装，而是部分终端拿不到 Node 路径。
- 假设 B：否定。依赖已完整安装，测试可直接通过。
- 假设 C：否定。`package.json` 中的测试脚本配置正常。
- 假设 D：否定。仓库当前不存在阻塞开发验证的测试错误。
- 假设 E：暂不需要进一步排查。本次阻塞点先于小程序/云环境，属于终端基础环境问题。

最终根因：
1. 用户级与系统级 `Path` 都未稳定包含 `C:\Program Files\nodejs`。
2. PowerShell 执行策略为 `Restricted`，导致用户 profile 无法执行，终端启动补丁失效。

已完成修复：
1. 将 `C:\Program Files\nodejs` 写入当前用户 `Path`。
2. 新增 PowerShell profile，在启动时补齐 Node 路径。
3. 将 PowerShell `CurrentUser` 执行策略调整为 `RemoteSigned`。
