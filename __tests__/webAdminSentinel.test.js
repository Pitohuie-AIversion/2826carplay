/**
 * @file webAdminSentinel.test.js
 * @description 运营指挥中心与微服务网关监控 (web-admin/index.html) 告警哨兵、跨平台 Webhook、熔断持久化与在线拨测历史自动化测试
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Web Admin Gateway Sentinel & Operations Center', () => {
  const htmlPath = path.join(__dirname, '..', 'web-admin', 'index.html');
  let html = '';
  let inlineJs = '';
  let sandbox = {};

  beforeAll(() => {
    expect(fs.existsSync(htmlPath)).toBe(true);
    html = fs.readFileSync(htmlPath, 'utf8');

    const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];
    const mainScript = scriptMatches.find(m => m[1] && m[1].includes('CLOUD_MICROSERVICES'));
    expect(mainScript).toBeDefined();
    inlineJs = mainScript[1];

    const createMockElement = () => ({
      style: {},
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        toggle: jest.fn()
      },
      children: [],
      appendChild: jest.fn(function (child) {
        this.children.push(child);
        return child;
      }),
      setAttribute: jest.fn(),
      innerText: '',
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(value) {
        this._innerHTML = String(value);
        this.children.length = 0;
      },
      value: ''
    });
    const elements = new Map();

    const window = {
      location: { href: 'http://localhost' },
      localStorage: {
        _store: {},
        getItem(key) { return this._store[key] || null; },
        setItem(key, val) { this._store[key] = String(val); },
        removeItem(key) { delete this._store[key]; }
      },
      document: {
        getElementById: jest.fn((id) => {
          if (!elements.has(id)) elements.set(id, createMockElement());
          return elements.get(id);
        }),
        querySelectorAll: jest.fn(() => []),
        createElement: jest.fn(createMockElement)
      }
    };

    sandbox = {
      window,
      document: window.document,
      localStorage: window.localStorage,
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
      setTimeout: jest.fn(),
      console,
      navigator: { clipboard: { writeText: jest.fn().mockResolvedValue() } },
      Date,
      Math,
      JSON,
      parseFloat,
      parseInt,
      fetch: jest.fn().mockResolvedValue({ ok: true })
    };

    vm.createContext(sandbox);
    vm.runInContext(inlineJs, sandbox);
  });

  test('HTML 包含完整 5 个视图面板和告警哨兵相关结构', () => {
    expect(html).toContain('id="view-fleet"');
    expect(html).toContain('id="view-gateway"');
    expect(html).toContain('id="view-diagnostic"');
    expect(html).toContain('id="view-logs"');
    expect(html).toContain('id="view-data"');
    expect(html).toContain('id="btnAlertSentinel"');
    expect(html).toContain('id="alertConfigModal"');
    expect(html).toContain('id="webhookPreviewBox"');
    expect(html).toContain('id="webhookJsonBox"');
    expect(html).toContain('id="webhookCurlBox"');
    expect(html).toContain('id="probeHistoryList"');
  });

  test('全量注册 57 个微服务网关且覆盖四大业务集群', () => {
    const totalCount = vm.runInContext('CLOUD_MICROSERVICES.length', sandbox);
    expect(totalCount).toBe(57);

    const clusters = vm.runInContext('CLOUD_MICROSERVICES.map(f => f.cluster)', sandbox);
    const uniqueClusters = new Set(clusters);
    expect(uniqueClusters).toContain('booking');
    expect(uniqueClusters).toContain('fleet');
    expect(uniqueClusters).toContain('governance');
    expect(uniqueClusters).toContain('observability');
  });

  test('企业微信 WeCom Markdown 规范 Webhook 报文生成', () => {
    const payload = vm.runInContext('buildWebhookPayload("wecom", { slaMin: 99.9, errorMax: 3.0, p95Max: 80 })', sandbox);
    expect(payload.msgtype).toBe('markdown');
    expect(typeof payload.markdown.content).toBe('string');
    expect(payload.markdown.content).toContain('🚨 【爱迦微服务网关告警】');
    expect(payload.markdown.content).toContain('bookingCreate');
    expect(payload.markdown.content).toContain('99.9%');
  });

  test('飞书 Feishu Interactive Card 规范 Webhook 报文生成', () => {
    const payload = vm.runInContext('buildWebhookPayload("feishu", { slaMin: 99.8, errorMax: 2.5, p95Max: 90 })', sandbox);
    expect(payload.msg_type).toBe('interactive');
    expect(payload.card.header.template).toBe('red');
    expect(payload.card.header.title.content).toContain('爱迦租车');
    expect(Array.isArray(payload.card.elements)).toBe(true);
    expect(payload.card.elements[0].fields.length).toBeGreaterThanOrEqual(4);
  });

  test('钉钉 DingTalk ActionCard 规范 Webhook 报文生成', () => {
    const payload = vm.runInContext('buildWebhookPayload("dingtalk", { slaMin: 99.85, errorMax: 2.0, p95Max: 100 })', sandbox);
    expect(payload.msgtype).toBe('actionCard');
    expect(payload.actionCard.title).toContain('爱迦租车');
    expect(payload.actionCard.singleTitle).toBe('进入网关排查');
    expect(payload.actionCard.singleURL).toContain('2826carplay');
  });

  test('在线诊断拨测流水历史记录正确维护与容量限制 (最多20条)', () => {
    vm.runInContext('clearProbeHistory()', sandbox);
    let count = vm.runInContext('PROBE_HISTORY.length', sandbox);
    expect(count).toBe(0);

    for (let i = 0; i < 25; i++) {
      vm.runInContext(`recordProbeHistory("fn_${i}", 200, 20 + ${i}, "探测正常")`, sandbox);
    }

    count = vm.runInContext('PROBE_HISTORY.length', sandbox);
    expect(count).toBe(20);

    const latest = vm.runInContext('PROBE_HISTORY[0]', sandbox);
    expect(latest.fnName).toBe('fn_24');
    expect(latest.status).toBe(200);
  });

  test('故障注入与熔断设置持久化至 LocalStorage', () => {
    vm.runInContext(`
      CIRCUIT_BREAKER_FAULTS['bookingCreate'] = 'TRIPPED';
      persistCircuitBreakerFaults();
    `, sandbox);

    const stored = sandbox.localStorage.getItem('AIJIA_CIRCUIT_BREAKER_FAULTS');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored);
    expect(parsed.bookingCreate).toBe('TRIPPED');

    vm.runInContext(`
      resetAllCircuitBreakers();
    `, sandbox);

    const storedAfterReset = sandbox.localStorage.getItem('AIJIA_CIRCUIT_BREAKER_FAULTS');
    expect(JSON.parse(storedAfterReset)).toEqual({});
  });

  test('告警哨兵规则阈值持久化至 LocalStorage', () => {
    vm.runInContext(`
      ALERT_CONFIG.slaMin = 99.95;
      ALERT_CONFIG.errorMax = 1.5;
      ALERT_CONFIG.p95Max = 60;
      ALERT_CONFIG.platform = 'feishu';
      persistAlertConfig();
    `, sandbox);

    const stored = sandbox.localStorage.getItem('AIJIA_ALERT_SENTINEL_CONFIG');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored);
    expect(parsed.slaMin).toBe(99.95);
    expect(parsed.errorMax).toBe(1.5);
    expect(parsed.p95Max).toBe(60);
    expect(parsed.platform).toBe('feishu');
  });

  test('智能客户画像标签引擎 (deriveBookingIntelligentTags & autoTagBooking) 与 shared/bookingTags.js 一致', () => {
    const tags = vm.runInContext(`
      deriveBookingIntelligentTags({
        rentalDays: 15,
        pickupCity: '杭州',
        returnCity: '上海',
        pickupLocation: '萧山机场送车上门',
        status: 'CONFIRMED',
        customerOrderCount: 3
      })
    `, sandbox);

    expect(Array.from(tags)).toEqual(['长租意向', '需要送车', '跨城用车', '高意向', '老客户']);

    const taggedBooking = vm.runInContext(`
      autoTagBooking({
        bookingId: 'BK_TEST_01',
        rentalDays: 7,
        pickupLocation: '西湖门店自提',
        status: 'PENDING'
      })
    `, sandbox);
    expect(Array.from(taggedBooking.intelligentTags)).toEqual(['长租意向']);
  });

  test('17个业务集合零信任规则、复合索引与脱敏字段白名单审查器完整就绪', () => {
    const colCount = vm.runInContext('COLLECTIONS_INFO.length', sandbox);
    expect(colCount).toBe(17);

    const allHaveMetadata = vm.runInContext(`
      COLLECTIONS_INFO.every(c => Array.isArray(c.indexDetails) && c.indexDetails.length > 0 && Array.isArray(c.whitelistFields) && c.whitelistFields.length > 0 && c.sampleDoc)
    `, sandbox);
    expect(allHaveMetadata).toBe(true);

    vm.runInContext('openCollectionInspector("bookings")', sandbox);
    const inspectedKey = vm.runInContext('currentInspectedCollection.key', sandbox);
    expect(inspectedKey).toBe('bookings');
  });

  test('四角存证交接核验台账与微信支付分订单联动结算', () => {
    const bookingsCount = vm.runInContext('RECONCILE_BOOKINGS.length', sandbox);
    expect(bookingsCount).toBeGreaterThanOrEqual(5);

    vm.runInContext('openHandoverEvidenceModal("BK_2026102502")', sandbox);
    const activeBookingId = vm.runInContext('currentHandoverBooking.bookingId', sandbox);
    expect(activeBookingId).toBe('BK_2026102502');
    const cornerCount = vm.runInContext('currentHandoverBooking.cornerPhotos.length', sandbox);
    expect(cornerCount).toBe(4);

    vm.runInContext('launchPayScoreFromHandover()', sandbox);
    const payScoreOrderNo = vm.runInContext('currentPayScoreBookingId', sandbox);
    expect(payScoreOrderNo).toBe('BK_2026102502');
    const select = sandbox.document.getElementById('payScoreBookingSelect');
    expect(select.value).toBe('BK_2026102502');
    expect(select.children).toHaveLength(bookingsCount);
    expect(new Set(select.children.map(option => option.value)).size).toBe(bookingsCount);
    vm.runInContext('launchPayScoreFromHandover()', sandbox);
    expect(select.children).toHaveLength(bookingsCount);
  });

  test('微服务熔断 Half-Open 半开探测自愈恢复与车队排期持久化', () => {
    vm.runInContext(`
      CIRCUIT_BREAKER_FAULTS['vehicleCalendarManage'] = 'TRIPPED';
      persistCircuitBreakerFaults();
    `, sandbox);
    expect(vm.runInContext('CIRCUIT_BREAKER_FAULTS["vehicleCalendarManage"]', sandbox)).toBe('TRIPPED');

    vm.runInContext('probeAndRecoverService("vehicleCalendarManage")', sandbox);
    expect(vm.runInContext('CIRCUIT_BREAKER_FAULTS["vehicleCalendarManage"]', sandbox)).toBeUndefined();

    vm.runInContext(`
      VEHICLES[0].status = 'maintenance';
      VEHICLES[0].schedule = '赛道日后底盘整备';
      persistFleetSchedules();
    `, sandbox);
    const fleetStored = JSON.parse(sandbox.localStorage.getItem('AIJIA_FLEET_SCHEDULE_STATE'));
    expect(fleetStored[0].status).toBe('maintenance');

    vm.runInContext('resetFleetSchedules()', sandbox);
    expect(vm.runInContext('VEHICLES[0].status', sandbox)).toBe('rented');
  });

  test('57函数智能拨测模板与 RBAC 三态权限白名单矩阵断言 (runAuthMatrixAssertion)', () => {
    const publicPayload = vm.runInContext('getPresetPayloadForFunction("garageVehicleList")', sandbox);
    expect(publicPayload.city).toBe('杭州');

    const handoverPayload = vm.runInContext('getPresetPayloadForFunction("bookingHandover")', sandbox);
    expect(Array.isArray(handoverPayload.cornerPhotos)).toBe(true);
    expect(handoverPayload.cornerPhotos.length).toBe(4);

    // Public whitelist function (garageVehicleList): anonymous should be 200 OK
    const pubMatrix = vm.runInContext('runAuthMatrixAssertion("garageVehicleList")', sandbox);
    expect(pubMatrix.isPublic).toBe(true);
    expect(pubMatrix.matrix[0].role).toBe('anonymous');
    expect(pubMatrix.matrix[0].status).toBe(200);

    // Authenticated function (bookingCreate): anonymous should be 403 AUTH_REQUIRED
    const authMatrix = vm.runInContext('runAuthMatrixAssertion("bookingCreate")', sandbox);
    expect(authMatrix.isPublic).toBe(false);
    expect(authMatrix.matrix[0].role).toBe('anonymous');
    expect(authMatrix.matrix[0].status).toBe(403);
    expect(authMatrix.matrix[1].status).toBe(200);
    expect(authMatrix.matrix[2].status).toBe(200);
  });

  test('云端自动化维护哨兵演练与 47 天档期跨度边界及按日占用锁冲突判定器', () => {
    const cronRes = vm.runInContext('triggerCronSentinel("analyticsCleanup")', sandbox);
    expect(cronRes.ok).toBe(true);
    expect(cronRes.fnName).toBe('analyticsCleanup');

    // 1. Overlap conflict test (v6 has lockedDays ['2026-10-25', '2026-10-26', '2026-10-27'])
    const conflictRes = vm.runInContext(`
      validateCalendarSpanAndConflict({
        vehicleId: 'v6',
        startDate: '2026-10-25',
        endDate: '2026-10-27'
      })
    `, sandbox);
    expect(conflictRes.ok).toBe(false);
    expect(conflictRes.code).toBe('CALENDAR_DAY_LOCK_CONFLICT');
    expect(conflictRes.conflictDays.length).toBe(3);

    // 2. Exceeding 47-day span limit test
    const overSpanRes = vm.runInContext(`
      validateCalendarSpanAndConflict({
        vehicleId: 'v1',
        startDate: '2026-11-01',
        endDate: '2026-12-30'
      })
    `, sandbox);
    expect(overSpanRes.ok).toBe(false);
    expect(overSpanRes.code).toBe('MAX_SPAN_EXCEEDED');
    expect(overSpanRes.spanDays).toBe(60);
    expect(overSpanRes.maxAllowedDays).toBe(47);

    // 3. Valid non-overlapping date range within 47 days
    const safeRes = vm.runInContext(`
      validateCalendarSpanAndConflict({
        vehicleId: 'v1',
        startDate: '2026-11-05',
        endDate: '2026-11-08'
      })
    `, sandbox);
    expect(safeRes.ok).toBe(true);
    expect(safeRes.code).toBe('CALENDAR_SPAN_SAFE');
    expect(safeRes.spanDays).toBe(4);
  });

  test('全链路网关 Trace 零 OpenID 泄露审计与 17 集合隐私合规工单盘点审批', () => {
    const tracePayload = vm.runInContext('openLatestTraceInspector()', sandbox);
    expect(tracePayload.openIdExposed).toBe(false);
    expect(tracePayload.callerMask).toBe('usr_mask_9f2a***');

    const inventory = vm.runInContext('buildPersonalDataInventory("PRV-20261026-01")', sandbox);
    expect(inventory.zeroOpenIdLeakageVerified).toBe(true);
    expect(inventory.totalCollectionsAudited).toBe(17);
    expect(inventory.scopedCollections.length).toBe(6);

    const approvedTicket = vm.runInContext('approveCurrentPrivacyTicket()', sandbox);
    expect(approvedTicket.status).toBe('APPROVED_ARCHIVED');
  });

  test('57 微服务公开白名单 (5) 与鉴权私有 (52) 矩阵与 scripts/cloudAuthAudit.js 完全一致', () => {
    const { EXPECTED_PUBLIC } = require('../scripts/cloudAuthAudit');
    const publicFns = Array.from(vm.runInContext('CLOUD_MICROSERVICES.filter(f => f.auth === "public").map(f => f.name)', sandbox));
    const authFns = Array.from(vm.runInContext('CLOUD_MICROSERVICES.filter(f => f.auth === "auth").map(f => f.name)', sandbox));

    expect(publicFns.length).toBe(5);
    expect(authFns.length).toBe(52);
    expect(new Set(publicFns)).toEqual(EXPECTED_PUBLIC);
  });

  test('云端异地容灾冷备与增量发布编排中心 (triggerColdBackup & cloudDbBackup / cloudAdminDeploy 默认 dry-run 守卫)', async () => {
    const fullManifest = vm.runInContext('triggerColdBackup("full_backup")', sandbox);
    expect(fullManifest.totalCollectionsInScope).toBe(17);
    expect(fullManifest.publicWhitelistFunctions).toBe(5);
    expect(fullManifest.authenticatedFunctions).toBe(52);
    expect(fullManifest.recommendedCommand).toBe('npm run cloud:backup -- --apply --all');

    const coreManifest = vm.runInContext('buildColdBackupManifest("core_backup")', sandbox);
    expect(coreManifest.totalCollectionsInScope).toBe(7);

    // Verify scripts/cloudDbBackup.js 17 collections & default dry-run safety
    const { ALL_COLLECTIONS, CORE_COLLECTIONS, runBackup } = require('../scripts/cloudDbBackup');
    const secManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'security-rules', 'manifest.json'), 'utf8'));
    const secCollections = secManifest.database.collections;
    const webAdminCollections = Array.from(vm.runInContext('COLLECTIONS_INFO.map(c => c.key)', sandbox));
    expect(ALL_COLLECTIONS.length).toBe(17);
    expect(CORE_COLLECTIONS.length).toBe(7);
    expect(new Set(ALL_COLLECTIONS)).toEqual(new Set(secCollections));
    expect(new Set(webAdminCollections)).toEqual(new Set(secCollections));

    const dryBackupRes = await runBackup({ flags: { '--all': true } });
    expect(dryBackupRes.mode).toBe('dry-run');
    expect(dryBackupRes.targetCollections.length).toBe(17);

    // Verify scripts/cloudAdminDeploy.js default dry-run safety
    const { deployAdmin } = require('../scripts/cloudAdminDeploy');
    const dryDeployRes = deployAdmin({ cli: false, flags: {} });
    expect(dryDeployRes.exitCode).toBe(0);
    expect(dryDeployRes.mode).toBe('dry-run');
  });

  test('节假日与周末动态定价试算引擎 (calculateDynamicRentalPricing) 与 shared/rentalPricing.js 一致', () => {
    const sharedPricing = require('../shared/rentalPricing');
    const options = {
      tiers: [
        { minDays: 3, discountRate: 0.95 },
        { minDays: 7, discountRate: 0.90 }
      ],
      weekendMultiplier: 1.15,
      holidayRules: [{ name: '黄金周峰值', startDate: '2026-10-26', endDate: '2026-10-28', multiplier: 1.30 }]
    };

    const expected = sharedPricing.calculateDynamicRentalPricing(4500, '2026-10-26', '2026-11-01', options);
    const actual = vm.runInContext(
      `calculateDynamicRentalPricing(4500, "2026-10-26", "2026-11-01", ${JSON.stringify(options)})`,
      sandbox
    );

    expect(actual.rentalDays).toBe(expected.rentalDays);
    expect(actual.originalTotal).toBe(expected.originalTotal);
    expect(actual.discountedTotal).toBe(expected.discountedTotal);
    expect(actual.savingsAmount).toBe(expected.savingsAmount);
    expect(actual.discountLabel).toBe(expected.discountLabel);
    expect(actual.dailyBreakdown.length).toBe(7);

    const errOver8 = vm.runInContext(
      `validateRentalDiscountTiers(Array.from({ length: 9 }, (_, i) => ({ minDays: i + 2, discountRate: 0.9 })))`,
      sandbox
    );
    expect(errOver8).toBe('连租折扣最多设置 8 档');
  });

  test('车队维保年检健康核算与四维运营预警雷达 (calculateMaintenanceHealth / buildFleetMaintenanceSummary / computeAlerts) 与 shared 完全一致', () => {
    const sharedMaint = require('../shared/vehicleMaintenance');
    const sharedAlerts = require('../shared/operationAlerts');

    const baseDateStr = '2026-10-26T00:00:00';
    const baseNowMs = new Date('2026-10-26T12:00:00Z').getTime();

    const vehicles = JSON.parse(vm.runInContext('JSON.stringify(DEFAULT_VEHICLES)', sandbox));
    const sampleBookings = JSON.parse(vm.runInContext('JSON.stringify(OPERATION_ALERT_SAMPLE_BOOKINGS)', sandbox));

    const expectedSummary = sharedMaint.buildFleetMaintenanceSummary(vehicles, new Date(baseDateStr));
    const actualModalState = vm.runInContext('openMaintenanceAlertModal()', sandbox);

    expect(actualModalState.summary).toEqual(expectedSummary);
    expect(actualModalState.summary.total).toBe(8);
    expect(actualModalState.summary.urgentCount).toBe(2);
    expect(actualModalState.summary.upcomingCount).toBe(2);
    expect(actualModalState.summary.healthyCount).toBe(4);
    expect(actualModalState.summary.attentionRequired).toBe(4);

    const expectedAlerts = sharedAlerts.computeAlerts(sampleBookings, vehicles, { now: baseNowMs });
    expect(JSON.parse(JSON.stringify(actualModalState.alerts))).toEqual(expectedAlerts);
    expect(actualModalState.alerts.map(a => a.type)).toEqual([
      'overdue_pending',
      'expiring_quote',
      'overdue_coordination',
      'maintenance_due'
    ]);

    // Complete maintenance on v2 (Ferrari 488 Pista) and verify state transition
    const maintDone = vm.runInContext('completeVehicleMaintenance("v2")', sandbox);
    expect(maintDone.vehicle.archiveDate).toBe('2027-04-24');
    expect(maintDone.vehicle.status).toBe('active');
    expect(maintDone.summary.urgentCount).toBe(1);
  });
});
