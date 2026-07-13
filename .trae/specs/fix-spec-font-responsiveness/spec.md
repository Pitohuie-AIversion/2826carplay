# 字体自适应修复 Spec

## Why
当前部分界面在不同屏宽和系统字体设置下存在字号偏大、换行拥挤、按钮文案容易显得顶格的问题，影响可读性和界面稳定性。
需要统一字体层级和文本容错规则，让主要页面在常见手机尺寸下都保持清晰、自然的排版效果。

## What Changes
- 盘点 `/spec` 相关界面中的标题、正文、辅助文案、按钮、标签等文本样式，收敛不合理的字号和行高
- 建立统一的字体层级，避免同类信息在不同页面出现过大或过小的视觉落差
- 为长文本、车牌、状态标签、按钮文案补充换行或截断策略，避免窄屏下溢出和拥挤
- 保持现有深色视觉风格与布局结构，不引入项目约束中禁止的兼容性风险写法

## Impact
- Affected specs: 页面多端适配、文本可读性、管理页信息展示
- Affected code: `app.wxss`, `components/car-card/car-card.wxss`, `pages/garage/garage.wxss`, `pages/car-detail/car-detail.wxss`, `pages/mine/mine.wxss`, `pages/vehicle-manage/vehicle-manage.wxss`, `pages/vehicle-detail-manage/vehicle-detail-manage.wxss`, `pages/vehicle-create/vehicle-create.wxss`, `pages/vehicle-edit/vehicle-edit.wxss`, `pages/booking/booking.wxss`

## ADDED Requirements
### Requirement: 字体响应式适配
系统 SHALL 为主要界面提供统一的字体层级与文本容错规则，使文本在窄屏和常规屏幕下都保持可读、不过度拥挤且不破坏布局。

#### Scenario: 窄屏设备显示
- **WHEN** 用户在较窄屏幕设备上打开页面
- **THEN** 标题、正文、按钮和标签文本仍保持清晰可读
- **AND** 不出现明显的文字溢出、重叠或按钮高度被文字撑破的情况

#### Scenario: 长文本显示
- **WHEN** 车牌、状态文案或按钮文字长度接近布局边界
- **THEN** 页面应使用明确的换行、单行省略或宽度约束策略处理
- **AND** 不影响相邻元素对齐和信息层级

## MODIFIED Requirements
### Requirement: 页面多端适配
系统 SHALL 继续使用 `rpx` 与 `flex` 完成多端适配，同时页面字体尺寸、行高和文本容器宽度也必须纳入适配范围，确保不同设备尺寸下的信息层级一致、点击区域稳定、文本内容可读。

#### Scenario: 统一字体层级
- **WHEN** 用户浏览首页、详情页、预约页和车辆管理相关页面
- **THEN** 同级别标题、正文、辅助文案和按钮文案应采用一致的字号梯度与行高策略
- **AND** 不因页面差异出现同类文本忽大忽小的问题

## REMOVED Requirements
- 无
