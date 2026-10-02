# 数据库模型与安全策略规范 (Database & Security Architecture)

极境车库（2826CarPlay）采用腾讯云开发（CloudBase）NoSQL 文档型数据库，严格贯彻“数据最小化”、“字段白名单”、“集合访问受控”与“隐私脱敏”等合规原则。

---

## 一、 云数据库集合全景 (16 Collections)

| 集合名称 (Collection) | 读写权限策略 | 核心用途与数据范畴 |
| :--- | :--- | :--- |
| `vehicles` | 仅云端读写 (Server Only) | 车辆基础信息、配置参数、日租金、状态机（在库/使用中/维护/停用）与图库。 |
| `bookings` | 仅云端读写 (Server Only) | 用户预约咨询主记录、取还车日期、服务城市、处理状态、顾问备注。 |
| `booking_quotes` | 仅云端读写 (Server Only) | 顾问发送给用户的不可变正式报价版本明细（包含日租合计、押金与保障费）。 |
| `booking_calendars` | 仅云端读写 (Server Only) | 车辆逐日排期锁定（Block）、保留区间与特殊日期浮动价规。 |
| `system_roles` | 仅云端读写 (Server Only) | 管理员 OpenID 身份、模块权限位（车辆、预约、配置、审计等）。 |
| `audit_logs` | 仅云端读写 (Server Only) | 管理操作安全审计台账，严格执行标识符最小化，不记录明文敏感信息。 |
| `error_logs` | 仅云端读写 (Server Only) | 设备端与云端异常日志，自动过滤用户 OpenID 与服务端敏感堆栈。 |
| `operation_configs` | 公开只读 / 云端写 | 全局运营参数、服务时间、客服配置、网点地址与租赁免责条款。 |
| `privacy_requests` | 仅云端读写 (Server Only) | 用户依据《个人信息保护法》发起的个人数据查询、更正、删除申请单。 |
| `privacy_exports` | 仅云端读写 (Server Only) | 用户导出的个人数据资产台账凭据与文件生命周期。 |
| `content_guides` | 仅云端读写 (Server Only) | 场景化自驾路书、精选内容指南及车型归因关联。 |
| `favorites` | 仅云端读写 (Server Only) | 用户收藏车辆映射关联（包含收藏时间与快速索引）。 |
| `pending_file_deletions` | 仅云端读写 (Server Only) | 车辆图片与留证照片异步安全清理队列（防并发覆写与漏删）。 |
| `analytics_events` | 仅云端读写 (Server Only) | 匿名化统计事件（车型浏览、报价核验、电话咨询、渠道分享）。 |
| `user_permissions` | 仅云端读写 (Server Only) | 管理员操作鉴权缓存与角色映射。 |
| `cloud_tasks` | 仅云端读写 (Server Only) | 异步任务调度与定期数据巡检状态。 |

---

## 二、 复合索引体系 (52 Compound Indexes)

为保证高并发下查询毫秒级响应，避免无索引全表扫描引发查询超时或 CloudBase 额度浪费，系统在 `cloudbaserc.json` 中预置了 **52 项复合索引**：

- **车辆与公开检索索引**：
  - `status_1_sort_1`：车库按状态与权重排序。
  - `category_1_status_1`：车库分类与状态联动筛选。
  - `city_1_status_1`：基于城市与可用性的复合过滤。
- **预约与时间冲突索引**：
  - `vehicleId_1_status_1`：车辆在途预约单与状态核验。
  - `openid_1_createTime_-1`：用户个人“我的预约”按时间倒序快速翻页。
  - `schedulePriority_1_createTime_1`：工作台智能排队与优先级队列。
- **排期日历与档期锁定索引**：
  - `vehicleId_1_date_1`：车辆逐日档期唯一性锁定与冲突排查。
  - `vehicleId_1_type_1_date_1`：特殊日期价规与人工锁车重叠判定。
- **审计与日志检索索引**：
  - `module_1_createTime_-1`：管理端按业务模块快速切片安全审计日志。
  - `functionName_1_createTime_-1`：异常错误日志按云函数维度排查。

> 每次部署或迁移环境前，运行 `npm run check:indexes` 进行全量索引合法性验证。

---

## 三、 数据安全与隐私合规准则 (Privacy Guardrails)

### 3.1 字段投影白名单 (Field Whitelist Projections)
客户端**严禁直接全量拉取数据库 Document**。云函数在数据库查询阶段必须使用 `.field({ ... })` 进行字段投影：
- **车辆数据**：公开车辆列表与详情仅返回品牌型号、标签、日租估算与封面，**严禁返回车辆 VIN 码、发动机号、内部采购价或管理员私有备注**。
- **预约数据**：用户端接口只返回用户自身可见的预约信息；车牌仅展示“尾号 XX”，严禁对外输出完整真实车牌号。
- **管理员权限**：鉴权接口只返回 boolean 类型的权限位清单，绝不透传后端完整角色记录或内部审计时间戳。

### 3.2 最小化安全审计与日志隐私
- 云函数在执行 `console.error` 或写入 `error_logs` / `audit_logs` 时，**严禁将用户的 OpenID、真实手机号、明文姓名、银行账号或云存储签名 URL 打印至持久化日志中**。
- 日志只允许记录安全摘要，如：`{ function: "bookingCreate", authenticated: true, vehicleId: "v_123" }`。
- 本项目包含专项自动化安全测试 [__tests__/logPrivacy.test.js](file:///g:/Autosave/2826carplay/__tests__/logPrivacy.test.js)，对所有云函数源码实施 AST 扫描，严防信息泄露回退。
