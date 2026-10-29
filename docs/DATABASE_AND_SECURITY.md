# 数据库模型与安全策略规范

爱迦租车采用腾讯云开发（CloudBase）文档型数据库。本文依据仓库中的 [安全规则清单](../security-rules/manifest.json)、[索引声明](../security-rules/database-indexes.json) 与相关云函数代码整理，描述静态配置和实现约定。集合数量、索引声明及本地检查结果均不证明目标云环境已创建对应资源、部署规则或完成索引构建；上线时仍需按 [部署清单](../DEPLOY_CHECKLIST.md) 核对实际环境。

## 一、集合清单与访问边界

`security-rules/manifest.json` 当前声明 **17 个集合**，统一引用 [database-deny-client.json](../security-rules/database-deny-client.json)：`read: false`、`write: false`。下表的“仅服务端读写”表示禁止客户端直接访问数据库；小程序需要经云函数完成相应业务操作，云函数还须校验调用者身份、业务权限和记录归属。

| 集合名称 | 读写权限策略 | 核心用途 |
| :--- | :--- | :--- |
| `admin_upload_sessions` | 仅服务端读写 | 管理员图片上传请求映射、会话、分块数据、上传配额与过期时间。 |
| `analytics_events` | 仅服务端读写 | 页面浏览、车辆咨询、分享等统计事件。 |
| `app_configs` | 仅服务端读写 | 运营参数、服务时间、客服与网点配置。公开配置通过云函数筛选后返回。 |
| `audit_logs` | 仅服务端读写 | 管理操作审计记录。 |
| `booking_handovers` | 仅服务端读写 | 取还车交接记录、照片、版本和用户确认状态。 |
| `booking_quotes` | 仅服务端读写 | 正式报价版本、费用明细、确认与调整申请状态。 |
| `bookings` | 仅服务端读写 | 预约主记录、联系人、取还车日期、服务城市、处理状态及顾问备注。 |
| `content_guides` | 仅服务端读写 | 自驾指南、发布状态与场景关联。 |
| `error_logs` | 仅服务端读写 | 客户端与云函数异常记录。 |
| `favorites` | 仅服务端读写 | 用户与收藏车辆的关联。 |
| `pending_file_deletions` | 仅服务端读写 | 图片延迟删除任务、重试状态与最早处理时间。 |
| `privacy_requests` | 仅服务端读写 | 用户个人数据查询、更正、删除等申请及处理状态。 |
| `roles` | 仅服务端读写 | 管理员身份与业务模块权限。 |
| `vehicle_availability_blocks` | 仅服务端读写 | 车辆人工锁定或不可用日期区间。 |
| `vehicle_calendar_days` | 仅服务端读写 | 车辆逐日占用记录及预约、锁定区间关联。 |
| `vehicle_price_rules` | 仅服务端读写 | 车辆日期价格规则。 |
| `vehicles` | 仅服务端读写 | 车辆信息、租金、状态、内部管理字段及图片。 |

## 二、索引声明与部署核对

索引文件位于 **`security-rules/database-indexes.json`**，由 manifest 的 `database.indexFile` 相对于 `security-rules/` 目录引用。`cloudbaserc.json` 中的云函数部署配置不是该索引清单。

当前索引文件共声明 **12 条索引**，包含单字段索引和复合索引；以下字段按声明顺序列出，`asc` 为升序，`desc` 为降序。

| 集合 | 索引名称 | 字段及顺序 | 唯一 |
| :--- | :--- | :--- | :--- |
| `admin_upload_sessions` | `admin_upload_sessions_expiresAt` | `expiresAt asc` | 否 |
| `admin_upload_sessions` | `admin_upload_sessions_openid_expiresAt` | `openid asc`、`expiresAt asc` | 否 |
| `content_guides` | `content_guides_slug_unique` | `slug asc` | 是 |
| `content_guides` | `content_guides_status_id` | `status asc`、`_id asc` | 否 |
| `content_guides` | `content_guides_status_publishedAt` | `status asc`、`publishedAt desc` | 否 |
| `content_guides` | `content_guides_scenario_status` | `scenario asc`、`status asc` | 否 |
| `roles` | `roles_openid_unique` | `openid asc` | 是 |
| `vehicles` | `vehicles_plateNumber_unique` | `plateNumber asc` | 是 |
| `app_configs` | `app_configs_key_unique` | `key asc` | 是 |
| `app_configs` | `app_configs_updatedAt` | `updatedAt desc` | 否 |
| `pending_file_deletions` | `pending_file_deletions_status_createdAt` | `status asc`、`createdAt asc` | 否 |
| `pending_file_deletions` | `pending_file_deletions_source_notBeforeAt` | `source asc`、`notBeforeAt asc` | 否 |

部署清单还列有查询所需的推荐索引，应分别核对“文件已声明”和“文档建议创建”的项目，不能将建议数量当作已部署数量。`npm run check:indexes` 执行 [本地索引检查脚本](../scripts/checkDatabaseIndexes.js)，检查仓库声明与部署文档并提示缺项；它不会连接云环境、创建索引或确认线上索引可用，也不构成查询性能保证。

`content_guides_status_id` 支持公开推荐按发布状态及 `_id` 顺序分批读取。场景、类型和车辆筛选先在数据库执行，发布时间沿用函数中的兼容解析；一次最多处理 2000 条匹配候选并额外探测 1 条，超限或中途失败不返回部分成功。多次查询不是一致性快照，部署前仍需检查可选筛选组合的实际查询计划与耗时，详见部署清单。

## 三、管理员上传会话的过期与清理

[adminImageUpload](../cloudfunctions/adminImageUpload/index.js) 使用 `admin_upload_sessions` 保存上传会话和分块，客户端通过该云函数传输图片，不直接读写此集合。函数依据服务端取得的 OpenID 校验调用者、上传对象及对应管理权限；跨用户会话不能由传入的 OpenID 指定访问。

- **业务过期**：上传会话有效期为创建后的 **15 分钟**，分块沿用会话过期时间。超过 `expiresAt` 后不能继续追加分块或新发起完成上传；已开始且仍有有效完成租约的会话继续保留上传名额。配额记录有独立的有效期，不能将集合内所有记录都视为 15 分钟过期。
- **请求与会话隔离**：`request` 记录将调用者与请求编号映射至随机会话编号，在事务内与新会话共同创建。有效期内的重复请求复用同一会话；过期并清理后再次创建使用不同编号，旧清理和取消只能操作旧会话。旧格式确定性编号的既有会话可继续读取，但不再创建该格式的新会话。请求映射沿用现有过期索引，不增加集合。
- **自动本人回收**：发起新的 `begin` 操作时，服务端自动尝试回收调用者本人已过期的记录。也可通过 `adminImageUpload` 的 `{ action: "cleanup", ownOnly: true }` 主动清理本人记录。该路径按服务端 OpenID 限定范围。
- **手动管理员清理**：具有管理员权限的调用者可使用 `{ action: "cleanup" }` 清理全体过期记录。每次最多查询 50 条候选记录，返回 `removed` 和 `hasMore`；返回 `hasMore: true` 时可继续分批调用。
- **回收保护**：清理只处理 `expiresAt` 已过去至少 **2 分钟**、且没有仍生效的完成上传租约的记录；事务内再次核对后，回收会话、对应分块或已过期配额。因此业务过期不等于立即物理删除，实际回收取决于后续清理调用。
- **显式放弃成品**：车辆 `cleanupUpload` 在事务内核对图片列表及封面引用，仅为未引用文件在 `pending_file_deletions` 写入 `uploadAbandoned: true`；自动预登记的待核验记录不写此标记。新的上传请求不再计算这些已放弃成品的目标占位，但每小时新建次数限制继续生效。尚未进入删除流程的迟到关联仍被允许，读取到真实引用后可以重复返回合法成品；`deleting` / `deleted` 标记一律阻止旧上传请求返回失效文件。

上述 `expiresAt` 索引是普通查询索引，文件中未声明数据库 TTL 自动删除策略，也未因此配置定时清理任务。上传完成后的云存储图片由 `pending_file_deletions` 等图片清理流程核对业务引用后处理；删除上传会话不代表删除已关联到车辆或交接记录的图片。

## 四、字段与日志约束

客户端接口应在完成权限和记录归属校验后，仅返回对应业务所需字段。数据库查询可通过 `.field({ ... })` 限定读取字段，响应构造还应使用明确的字段清单；查询投影本身不能代替鉴权。公开车辆信息与内部管理字段、用户本人预约与他人预约、公开运营配置与管理员配置应分别控制。

日志与审计应仅记录排查所需的业务摘要，避免写入原始 OpenID、明文联系人信息、完整请求对象、临时签名 URL 或未经筛选的异常内容。是否需要保存某项字段，应按具体用途和访问范围审查，不能仅凭集合名或本地规则宣称数据已匿名化。

[logPrivacy.test.js](../__tests__/logPrivacy.test.js) 包含针对日志调用、字段投影等源码片段的字符串和正则回归检查。它不执行全量 AST 安全扫描，也不能证明所有动态执行路径或线上历史日志均无敏感信息。实际部署规则、接口返回和日志内容仍需分别验证。
