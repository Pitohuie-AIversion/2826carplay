# RUN_PROMPT.md

## Agent 启动提示词

将下面这段话复制给 Trae / Cursor / Codex Agent 使用。

```text
请先阅读以下文件：

1. agent.md
2. PROJECT_CONSTRAINTS.md
3. TODOlist.md
4. DESIGN.md
5. DATA_SCHEMA.md
6. TEST_CHECKLIST.md
7. CURRENT_PHASE.md

严格按照 CURRENT_PHASE.md 中声明的当前阶段执行任务。

每次只完成一个 Phase。
完成后必须停止并汇报。
不得自动进入下一阶段。
不得新增超出 PROJECT_CONSTRAINTS.md 的功能。
不得更换技术栈。
不得引入第三方 UI 框架。
不得接入支付、地图、云开发、真实订单、身份认证、驾驶证认证。

完成后按以下格式汇报：

完成阶段：
修改文件：
新增文件：
主要改动：
测试方式：
已知问题：
下一步建议：
```

## 进入下一阶段的提示词

当用户确认上一阶段完成后，可以把 `CURRENT_PHASE.md` 改为下一阶段，再输入：

```text
我已经确认上一阶段结果。请继续阅读 CURRENT_PHASE.md，只执行当前阶段任务。完成后停止并汇报。
```

## 修复问题的提示词

如果某阶段出现问题，使用：

```text
请只修复当前阶段发现的问题，不要新增功能，不要进入下一阶段。修复完成后列出修改文件和测试方式。
```
