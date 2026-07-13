# Tasks

- [x] Task 1: 盘点 `/spec` 相关界面的字体自适应问题并确定统一字号梯度
  - [x] 识别标题、正文、辅助文案、按钮、标签等文本类型
  - [x] 标记字号过大、行高不协调、长文本易溢出的页面和样式位置
  - [x] 确认需要统一收敛的字体层级与容错策略

- [x] Task 2: 调整全局与页面级文本样式
  - [x] 收敛不合理的 `font-size`、`line-height` 与文本容器宽度设置
  - [x] 为长文本、按钮文案、状态标签补充换行或截断策略
  - [x] 保持现有配色、间距和 `flex` 布局结构不被破坏

- [x] Task 3: 验证主要页面在不同屏宽下的显示效果
  - [x] 检查窄屏与常规屏下标题、正文、按钮、标签的可读性
  - [x] 确认无文字重叠、异常截断、按钮高度塌陷或布局抖动
  - [x] 复核样式实现未引入项目约束中禁止的兼容性写法
  - [x] 复核 `checklist.md` 的所有验收项并同步勾选结果

- [x] Task 4: 修复 `pages/vehicle-edit/vehicle-edit.wxss` 中禁止使用的 `:last-child` 选择器
  - [x] 在 `pages/vehicle-edit/vehicle-edit.wxml` 为最后一个字段显式增加普通类名
  - [x] 在 `pages/vehicle-edit/vehicle-edit.wxss` 中使用普通类替代 `.field-group:last-child`
  - [x] 保持最后一个字段的底部间距表现与修复前一致

# Task Dependencies

- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 has no additional dependency
