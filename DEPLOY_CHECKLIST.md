# 极境车库上线部署清单

## 1. 部署前确认

- 当前云环境：`cloud1-d8gtmns36320e045e`
- 云函数根目录：`cloudfunctions/`
- 运行时：`Nodejs16.13`
- 本地回归基线：`npm test` 通过，当前为 `29 suites / 112 tests`

## 2. 必须部署的云函数

以下函数已在 `cloudbaserc.json` 中纳入部署清单，部署时应全部同步：

- `auditLogList`
- `bookingCancel`
- `bookingCreate`
- `bookingDetail`
- `bookingExportCsv`
- `bookingList`
- `bookingMyDetail`
- `bookingMyList`
- `bookingUpdateAdminRemark`
- `bookingUpdateStatus`
- `bootstrapAdmin`
- `errorLogList`
- `garageVehicleList`
- `getMyPermissions`
- `getOpenid`
- `operationConfigGet`
- `operationConfigUpdate`
- `roleList`
- `roleUpsert`
- `vehicleCreate`
- `vehicleDelete`
- `vehicleDetail`
- `vehicleImageUpdate`
- `vehicleList`
- `vehiclePublicDetail`
- `vehicleRestore`
- `vehicleRetire`
- `vehicleUpdate`
- `vehicleUpdateStatus`

## 3. 数据库集合检查

上线前确认以下集合已存在：

- `vehicles`
- `bookings`
- `roles`
- `app_configs`
- `audit_logs`
- `error_logs`
- `pending_file_deletions`

## 4. 建议索引

建议在云数据库控制台补以下索引：

- `audit_logs.createdAt`
- `audit_logs.action`
- `error_logs.createdAt`
- `error_logs.function`
- `bookings.openid + createdAt`
- `roles.openid`
- `vehicles.plateNumber`

## 5. 环境变量

- `bootstrapAdmin` 需要配置 `BOOTSTRAP_TOKEN`
- 未配置时，首个管理员初始化会被锁定
- 生产环境不要把 token 明文写入仓库或前端

## 6. 上线前人工检查

### 用户侧

- 首页车辆列表正常加载，失败时显示明确错误与重试
- 车辆详情页正常打开，失败时显示明确错误与重试
- 预约页正常提交
- 我的预约支持分页加载
- 我的预约详情可正常查看
- 用户可取消自己的预约

### 管理侧

- “我的”页能按权限显示管理入口
- 权限管理页只允许管理员访问
- 运营配置页加载失败时不会误保存默认值
- 车辆管理、预约管理、审计日志、错误日志页均有前置鉴权
- 审计日志可筛到 `bookingCreate`、`bookingCancel`、`vehicleCreate`、`vehicleRetire`、`vehicleRestore`
- 错误日志可筛到 `vehicleUpdateStatus` 等关键函数

## 7. 上线后冒烟

- 创建一条预约，确认 `audit_logs` 出现 `bookingCreate`
- 取消该预约，确认 `audit_logs` 出现 `bookingCancel`
- 新增一辆车，确认 `audit_logs` 出现 `vehicleCreate`
- 停用并恢复车辆，确认 `audit_logs` 出现 `vehicleRetire` / `vehicleRestore`
- 人为制造一次后台异常，确认 `error_logs` 可被管理页查询

## 8. 风险提示

- 如果 `cloudbaserc.json` 未同步新增函数，部署时会漏掉 `bookingDetail`、`bookingMyDetail`、`errorLogList` 等能力
- 如果缺少 `audit_logs` / `error_logs` 集合，best-effort 日志会被忽略，主流程仍可运行，但线上排障和追溯会缺失
- `roleList` 目前仍是固定上限读取，不是标准分页接口；当前规模可用，如后台角色量明显增长，建议下一轮补齐

## 9. 建议上线顺序

1. 部署全部云函数
2. 创建集合并补索引
3. 配置 `BOOTSTRAP_TOKEN`
4. 真机跑用户侧主流程
5. 真机跑管理侧主流程
6. 检查审计日志与错误日志是否可见
7. 再提交体验版或正式版
