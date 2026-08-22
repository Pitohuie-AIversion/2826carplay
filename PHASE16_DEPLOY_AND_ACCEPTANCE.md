# Phase 16 部署与真实身份验收

## 部署边界

本阶段只新增内容增长与匿名渠道归因，不包含支付、押金、合同、证件认证、地图、优惠券、会员或虚假合作套餐。

部署前先保留 Phase 13–15 的三份未提交闭环记录，建议由维护者单独提交后再提交本阶段代码。

## 云端部署顺序

1. 创建 `content_guides` 集合，并应用 `security-rules/database-deny-client.json`，确认客户端读写均为 `false`。
2. 按 `security-rules/database-indexes.json` 创建三个索引：`slug` 唯一索引、`status + publishedAt`、`scenario + status`。
3. 部署 `contentGuideList`、`contentGuideDetail`、`contentGuideManage`。
4. 重新部署 `analyticsTrack`、`analyticsOverview`、`bookingCreate`、`bookingQuoteRespond`。
5. 上传并预览小程序代码，确认主包仍低于 1.75 MiB。
6. 管理员通过云开发控制台调用 `contentGuideManage` 创建真实内容，检查草稿后再执行发布；不要插入虚构合作套餐。

## 2026-08-21 实际部署记录

目标环境：`cloud1-d8gtmns36320e045e`（上海）。本次仅部署 Phase 16 所需资源，没有删除、迁移或重建既有云函数与业务集合。

| 项目 | 实际结果 |
| --- | --- |
| `content_guides` 集合 | 已创建 |
| 客户端权限 | `CUSTOM`，`read: false`、`write: false`，已回读确认 |
| `slug` 唯一索引 | `content_guides_slug_unique`，已创建 |
| `status + publishedAt` 索引 | `content_guides_status_publishedAt`，已创建 |
| `scenario + status` 索引 | `content_guides_scenario_status`，已创建 |
| 新云函数 | `contentGuideList`、`contentGuideDetail`、`contentGuideManage`，Node.js 20.19，状态均为 `Active/Available` |
| 更新云函数 | `analyticsTrack`、`analyticsOverview`、`bookingCreate`、`bookingQuoteRespond`，状态均为部署完成；保留既有运行时配置 |
| 发布内容冒烟样本 | `handover-checklist-2026`（文档 ID：`6a87c7eb3df9c6ceee5bcab0`），关联真实在库 BMW 525 Li 与奥迪 A6L |
| 本地发布检查 | `npm run check:release` 通过：113 个测试套件、981 项测试；主包约 1.65 MiB |
| 真机预览 | 首次生成被微信开发者工具以 `code 10` 拒绝：开发者登录已过期；已生成重新登录二维码，等待有权限账号扫码后继续 |

云端无身份调用冒烟结果：公开列表和详情正常返回已发布内容及关联车辆公开字段；内容管理返回 `FORBIDDEN`；匿名调用预约、报价响应和分析管理函数返回 `UNAUTHORIZED` 或 `FORBIDDEN`。这些结果只验证云端部署、公开字段边界和无身份拒绝，不替代下方双账号真机验收。

创建内容示例：

```json
{
  "action": "create",
  "guide": {
    "slug": "weekend-short-trip",
    "title": "周末短途用车准备",
    "summary": "根据真实车辆与服务范围整理的出发前提示",
    "body": "1. 出发前检查\n确认车辆档案、档期和报价。\n\n2. 取还车准备\n按数字交接流程核对照片、里程和油电量。",
    "contentType": "route",
    "scenario": "weekend_trip",
    "vehicleIds": ["替换为真实车辆ID"],
    "tags": ["周末短途", "取还车"],
    "shareTitle": "周末短途用车准备"
  }
}
```

发布时使用创建结果中的文档 ID：

```json
{ "action": "publish", "id": "替换为内容文档ID" }
```

## Phase 13–16 真实微信身份验收

需要两个不同微信账号：一个真实管理员、一个没有管理权限的普通用户。所有步骤均在真机预览或体验版完成。

### 管理员

- 维护一辆真实测试车辆的公开可信档案与内部记录，确认用户端只看到公开摘要。
- 创建并发送一版真实测试报价，确认报价发送后不可变。
- 检查车辆日历在报价发送前不锁档，在普通用户确认后按日生成占用。
- 为同一预约完成取车、还车交接，上传四角照片、里程和油电量，确认版本留痕与归档清理。
- 将预约推进到完成状态，确认占用、交接和预约状态一致。
- 创建一条真实场景内容并发布；确认草稿和归档内容无法从用户端读取。
- 打开数据分析，核对内容浏览、分享落地、预约提交与确认预约的内容/车辆/来源排名。

### 普通用户

- 从分享卡片进入内容页，确认标题、场景、关联车辆恢复正确。
- 依次打开关联车辆并发起预约，提交真实测试日期与联系方式。
- 查看管理员发送的报价并确认，确认页面没有展示付款成功、合同生效或证件认证状态。
- 查看并核对取车与还车交接记录；完成后检查“我的预约”的最终状态。
- 尝试调用内容维护能力，确认返回 `FORBIDDEN`。

### 参数与隐私复核

- 分别测试未知 `channel`、未知 `scene`、65 字符以上 ID、含路径字符的 ID，确认参数被丢弃或拒绝且不会跳转到任意 URL。
- 检查 `analytics_events` 抽样记录，只允许事件类型、内容 ID、车辆 ID、渠道、场景和服务端时间，不得出现 OpenID、预约 ID、姓名、手机号、备注或详细行程。
- 重复确认同一报价，确认不会重复写入 `content_booking_confirmed`。
- 订阅消息模板为可选项；未配置时不得阻断报价、档期或交接验收。

## 验收记录

| 项目 | 管理员账号 | 普通用户账号 | 时间 | 结果/问题 |
| --- | --- | --- | --- | --- |
| 可信档案公开/内部隔离 |  |  |  |  |
| 报价确认与按日占用 |  |  |  |  |
| 取还车照片与版本 |  |  |  |  |
| 完成预约 |  |  |  |  |
| 内容发布与分享恢复 |  |  |  |  |
| 渠道确认归因 |  |  |  |  |
