import assert from "node:assert/strict";
import {resolve} from "node:path";
import test from "node:test";
import {loadLaneConfigOracle, REQUIRED_OPERATIONAL_VIEW_KEYS} from "../src/lane-config.js";
import {
  assessPageZeroAlarmVisibility,
  assessPageZeroRefillAfterAdjudication,
  assessPageZeroReturnCutoffPreservation,
  assessScopedViewIsolation,
  buildCycleExecutionPlan,
  buildEventRowCssSelector,
  collectConSysPaginatedItems,
  compareAlarmsByViewerPriority,
  DEFAULT_OPERATOR_RECYCLE_CYCLES,
  deriveAlarmStatusFromResult,
  extractConSysNextPath,
  isAlarmGridHydrationSettled,
  isBenignViewerConsoleError,
  MAX_BULK_ADJUDICATION_ROWS,
  parseUiEnduranceCliArgs,
  SECONDARY_INSPECTION_STATUSES,
  selectAdjudicationCandidates,
  shouldPurgePriorScopedNotification,
  UI_ENDURANCE_WORKFLOWS,
  type AlarmEventSummary,
  type RenderedEventRow,
} from "../src/ui-endurance-oracles.js";

const canonicalOracle = loadLaneConfigOracle(resolve("fixtures/oscar-50-lane-config.csv"));

function makeAlarm(overrides: Partial<AlarmEventSummary> & {observationId: string}): AlarmEventSummary {
  return {
    observationId: overrides.observationId,
    laneId: overrides.laneId ?? "Lane01",
    occupancyCount: overrides.occupancyCount ?? "100",
    startTime: overrides.startTime ?? "2026-11-03T12:00:00.000Z",
    endTime: overrides.endTime ?? "2026-11-03T12:00:05.000Z",
    status: overrides.status ?? "Gamma",
    adjudicatedIdsCount: overrides.adjudicatedIdsCount ?? 0,
  };
}

function makeRow(laneId: string, occupancyCount: string, status = "Gamma"): RenderedEventRow {
  return {
    rowKey: `${laneId}:${occupancyCount}`,
    laneId,
    occupancyCount,
    status,
    startTimeText: "11/3/2026, 12:00:00 PM",
  };
}

test("compareAlarmsByViewerPriority orders Gamma & Neutron > Neutron > Gamma and newest first", () => {
  const alarms = [
    makeAlarm({observationId: "g-old", status: "Gamma", startTime: "2026-11-03T12:00:00.000Z"}),
    makeAlarm({observationId: "gn-old", status: "Gamma & Neutron", startTime: "2026-11-03T12:00:00.000Z"}),
    makeAlarm({observationId: "n-new", status: "Neutron", startTime: "2026-11-03T12:05:00.000Z"}),
    makeAlarm({observationId: "gn-new", status: "Gamma & Neutron", startTime: "2026-11-03T12:05:00.000Z"}),
    makeAlarm({observationId: "g-new", status: "Gamma", startTime: "2026-11-03T12:05:00.000Z"}),
  ];
  const sorted = [...alarms].sort(compareAlarmsByViewerPriority);
  assert.deepEqual(
    sorted.map((a) => a.observationId),
    ["gn-new", "gn-old", "n-new", "g-new", "g-old"],
  );
});

test("deriveAlarmStatusFromResult handles category codes and boolean flags", () => {
  assert.equal(deriveAlarmStatusFromResult({gammaAlarm: true, neutronAlarm: true}), "Gamma & Neutron");
  assert.equal(deriveAlarmStatusFromResult({gammaAlarm: true, neutronAlarm: false}), "Gamma");
  assert.equal(deriveAlarmStatusFromResult({gammaAlarm: false, neutronAlarm: true}), "Neutron");
  assert.equal(deriveAlarmStatusFromResult({gammaAlarm: false, neutronAlarm: false}), "None");
  assert.equal(
    deriveAlarmStatusFromResult({alarmCategoryCode: "Neutron", gammaAlarm: false, neutronAlarm: false}),
    "Neutron",
  );
});

test("assessPageZeroAlarmVisibility distinguishes expected lower-priority overflow from dropped Page-0 alarms", () => {
  const fifteenGn: AlarmEventSummary[] = Array.from({length: 15}, (_, idx) =>
    makeAlarm({
      observationId: `gn-${idx}`,
      laneId: "Lane01",
      occupancyCount: String(100 + idx),
      status: "Gamma & Neutron",
      startTime: new Date(Date.parse("2026-11-03T12:00:00.000Z") + idx * 1000).toISOString(),
    }),
  );
  const renderedFifteenGn = fifteenGn.map((a) => makeRow(a.laneId, a.occupancyCount, a.status));

  // A new Gamma-only alarm sorts at rank 15 behind 15 Gamma & Neutron alarms: not expected on Page 0
  const gammaOnlyNew = makeAlarm({
    observationId: "gamma-16",
    laneId: "Lane02",
    occupancyCount: "999",
    status: "Gamma",
    startTime: "2026-11-03T12:10:00.000Z",
  });
  const overflowResult = assessPageZeroAlarmVisibility({
    currentPageZeroEvents: fifteenGn,
    newlyArrivedEvents: [gammaOnlyNew],
    renderedRows: renderedFifteenGn,
  });
  assert.equal(overflowResult.passed, true);
  assert.equal(overflowResult.expectedOnPageZero.length, 0);

  // A new Gamma & Neutron alarm has newest timestamp so it MUST enter Page 0 at rank 0
  const gnNew = makeAlarm({
    observationId: "gn-newest",
    laneId: "Lane03",
    occupancyCount: "1000",
    status: "Gamma & Neutron",
    startTime: "2026-11-03T12:10:00.000Z",
  });
  const missingResult = assessPageZeroAlarmVisibility({
    currentPageZeroEvents: fifteenGn,
    newlyArrivedEvents: [gnNew],
    renderedRows: renderedFifteenGn,
  });
  assert.equal(missingResult.passed, false);
  assert.equal(missingResult.missingFromDom.length, 1);
  assert.equal(missingResult.missingFromDom[0]?.observationId, "gn-newest");

  const presentResult = assessPageZeroAlarmVisibility({
    currentPageZeroEvents: fifteenGn,
    newlyArrivedEvents: [gnNew],
    renderedRows: [makeRow("Lane03", "1000", "Gamma & Neutron"), ...renderedFifteenGn.slice(0, 14)],
  });
  assert.equal(presentResult.passed, true);
  assert.equal(presentResult.matchedInDom.length, 1);

  // Even if ConSys snapshot is partial, 15 rendered Neutron rows in DOM prevent false Gamma failure
  const renderedFifteenNeutron = Array.from({length: 15}, (_, idx) =>
    makeRow("Lane10", String(200 + idx), "Neutron"),
  );
  const partialSnapshotResult = assessPageZeroAlarmVisibility({
    currentPageZeroEvents: [],
    newlyArrivedEvents: [gammaOnlyNew],
    renderedRows: renderedFifteenNeutron,
  });
  assert.equal(partialSnapshotResult.passed, true);
  assert.equal(partialSnapshotResult.expectedOnPageZero.length, 0);

  // Same-second sub-second tie at row 15: DOM toLocaleString() drops milliseconds (.000s vs .620s)
  const sameSecondDomRows: RenderedEventRow[] = Array.from({length: 15}, (_, idx) => ({
    rowKey: `Lane20:${300 + idx}`,
    laneId: "Lane20",
    occupancyCount: String(300 + idx),
    status: "Gamma",
    startTimeText: "11/3/2026, 12:10:00 PM",
    startTimeMs: Date.parse("2026-11-03T12:10:00.000Z"),
  }));
  const sameSecondGammaArrival = makeAlarm({
    observationId: "gamma-same-second",
    laneId: "Lane21",
    occupancyCount: "901",
    status: "Gamma",
    startTime: "2026-11-03T12:10:00.620Z",
  });
  const sameSecondTieResult = assessPageZeroAlarmVisibility({
    currentPageZeroEvents: [],
    newlyArrivedEvents: [sameSecondGammaArrival],
    renderedRows: sameSecondDomRows,
  });
  assert.equal(sameSecondTieResult.passed, true);
  assert.equal(sameSecondTieResult.expectedOnPageZero.length, 0);
});

test("assessScopedViewIsolation passes exact membership and flags leaked cards, rows, and notifications", () => {
  const eastLanes = canonicalOracle.lanesByView.get("east-gate") ?? [];
  assert.equal(eastLanes.length, 10);

  const clean = assessScopedViewIsolation({
    viewKey: "east-gate",
    oracle: canonicalOracle,
    renderedCardLanes: eastLanes,
    renderedTableRows: [makeRow("Lane01", "501"), makeRow("Lane10", "502")],
    notifications: [
      {tag: "alarm-notification-node-1", laneId: "Lane02", viewKey: "east-gate"},
    ],
  });
  assert.equal(clean.passed, true);

  const leaked = assessScopedViewIsolation({
    viewKey: "east-gate",
    oracle: canonicalOracle,
    renderedCardLanes: [...eastLanes.slice(0, 9), "Lane25"],
    renderedTableRows: [makeRow("Lane01", "501"), makeRow("Lane42", "509")],
    notifications: [
      {tag: "alarm-notification-node-2", laneId: "Lane33", viewKey: "west-gate"},
    ],
  });
  assert.equal(leaked.passed, false);
  assert.deepEqual(leaked.missingCardLanes, ["Lane10"]);
  assert.deepEqual(leaked.unexpectedCardLanes, ["Lane25"]);
  assert.deepEqual(leaked.outOfScopeTableLanes, ["Lane42"]);
  assert.deepEqual(leaked.outOfScopeNotificationLanes, ["Lane33"]);
  assert.equal(leaked.mismatchedNotificationViews.length, 1);
});

test("selectAdjudicationCandidates excludes reserved lane, out-of-scope lanes, and caps bulk count at 2", () => {
  const rows = [
    makeRow("Lane50", "101"),
    makeRow("Lane15", "102"),
    makeRow("Lane02", "103"),
    makeRow("Lane02", "103"),
    makeRow("Lane05", "104"),
    makeRow("Lane07", "105"),
  ];
  const eastAllowed = new Set(canonicalOracle.lanesByView.get("east-gate") ?? []);
  const selected = selectAdjudicationCandidates({
    rows,
    reservedLaneLabel: "Lane50",
    allowedLanes: eastAllowed,
    recentlyAdjudicatedKeys: new Set(["Lane02#103"]),
    count: 1,
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.laneId, "Lane05");

  const bulkPair = selectAdjudicationCandidates({
    rows,
    reservedLaneLabel: "Lane50",
    count: MAX_BULK_ADJUDICATION_ROWS,
  });
  assert.equal(bulkPair.length, 2);
  assert.deepEqual(
    bulkPair.map((r) => `${r.laneId}#${r.occupancyCount}`),
    ["Lane15#102", "Lane02#103"],
  );

  assert.throws(() =>
    selectAdjudicationCandidates({
      rows,
      reservedLaneLabel: "Lane50",
      count: 3,
    }),
  );
});

test("buildCycleExecutionPlan rotates across all workflows, operational views, inspections, and isotope modes", () => {
  const workflows = new Set<string>();
  const scopedViews = new Set<string>();
  const inspections = new Set<string>();
  const isotopeModes = new Set<string>();
  const detailQrModes = new Set<string>();

  for (let i = 0; i < 28; i++) {
    const plan = buildCycleExecutionPlan({
      cycleIndex: i,
      runTag: "TEST01",
      configuredViews: REQUIRED_OPERATIONAL_VIEW_KEYS,
      scopedHoldCycles: 4,
    });
    workflows.add(plan.workflow);
    scopedViews.add(plan.scopedWatcherViewKey);
    inspections.add(plan.secondaryInspection);
    isotopeModes.add(plan.isotopePlan.mode);
    if (plan.workflow === "pwa-notification-detail" || plan.workflow === "event-log-filter-detail") {
      detailQrModes.add(plan.qrClearMode);
    }
    assert.match(plan.vehicleId, /^NIMO-UI-TEST01-\d{5}$/);
  }

  assert.deepEqual([...workflows].sort(), [...UI_ENDURANCE_WORKFLOWS].sort());
  assert.deepEqual([...scopedViews].sort(), [...REQUIRED_OPERATIONAL_VIEW_KEYS].sort());
  assert.deepEqual([...inspections].sort(), [...SECONDARY_INSPECTION_STATUSES].sort());
  assert.deepEqual([...isotopeModes].sort(), ["multi", "single", "unknown-exclusivity"]);
  assert.deepEqual([...detailQrModes].sort(), ["clear-all-in-dialog", "delete-in-form"]);
});

test("parseUiEnduranceCliArgs defaults to 4 bounded cycles and supports continuous daemon flags", () => {
  const boundedDefault = parseUiEnduranceCliArgs([], {});
  assert.equal(boundedDefault.maxCycles, 4);
  assert.equal(boundedDefault.scopedHoldCycles, 1);
  assert.equal(boundedDefault.operatorRecycleCycles, DEFAULT_OPERATOR_RECYCLE_CYCLES);
  assert.equal(boundedDefault.readOnlyWallboard, false);

  const daemon = parseUiEnduranceCliArgs(
    [
      "--continuous",
      "--interval-ms",
      "15000",
      "--scoped-hold-cycles",
      "6",
      "--operator-recycle-cycles",
      "10",
    ],
    {},
  );
  assert.equal(daemon.maxCycles, undefined);
  assert.equal(daemon.durationSeconds, undefined);
  assert.equal(daemon.cycleIntervalMs, 15_000);
  assert.equal(daemon.scopedHoldCycles, 6);
  assert.equal(daemon.operatorRecycleCycles, 10);

  assert.throws(() => parseUiEnduranceCliArgs(["--unknown-flag"], {}));
  assert.throws(() => parseUiEnduranceCliArgs(["--max-cycles", "0"], {}));
});

test("buildCycleExecutionPlan schedules periodic operator tab recycling without recycling cycle 0", () => {
  const c0 = buildCycleExecutionPlan({
    cycleIndex: 0,
    runTag: "MEM01",
    scopedHoldCycles: 4,
    operatorRecycleCycles: 12,
  });
  const c11 = buildCycleExecutionPlan({
    cycleIndex: 11,
    runTag: "MEM01",
    scopedHoldCycles: 4,
    operatorRecycleCycles: 12,
  });
  const c12 = buildCycleExecutionPlan({
    cycleIndex: 12,
    runTag: "MEM01",
    scopedHoldCycles: 4,
    operatorRecycleCycles: 12,
  });
  assert.equal(c0.recycleOperatorTab, false);
  assert.equal(c11.recycleOperatorTab, false);
  assert.equal(c12.recycleOperatorTab, true);
});

test("isBenignViewerConsoleError filters offline WebID DRF noise while keeping Service Worker errors fatal", () => {
  assert.equal(
    isBenignViewerConsoleError("Failed to fetch DRF values: TypeError: Failed to fetch"),
    true,
  );
  assert.equal(
    isBenignViewerConsoleError("Failed to load resource: net::ERR_CONNECTION_RESET"),
    true,
  );
  assert.equal(
    isBenignViewerConsoleError("Service Worker registration failed: SecurityError"),
    false,
  );
  assert.equal(
    isBenignViewerConsoleError("Uncaught TypeError: Cannot read properties of undefined"),
    false,
  );
});

test("shouldPurgePriorScopedNotification purges prior scoped views while preserving unscoped and active views", () => {
  assert.equal(shouldPurgePriorScopedNotification("exit", "east-gate"), true);
  assert.equal(shouldPurgePriorScopedNotification("west-gate", "east-gate"), true);
  assert.equal(shouldPurgePriorScopedNotification("east-gate", "east-gate"), false);
  assert.equal(shouldPurgePriorScopedNotification(null, "east-gate"), false);
  assert.equal(shouldPurgePriorScopedNotification(undefined, "east-gate"), false);
  assert.equal(shouldPurgePriorScopedNotification("", "east-gate"), false);
});

test("isAlarmGridHydrationSettled prevents premature return during cold 7th-view tab recycle discovery", () => {
  // Early observation probe finished >800ms ago, but scoped LaneStatus cards are still hydrating (0/10): must NOT settle.
  assert.equal(
    isAlarmGridHydrationSettled({
      seenObsRequests: 1,
      inFlightObsRequests: 0,
      lastObsEventMs: 1_000,
      nowMs: 2_500,
      renderedCardCount: 0,
      expectedCardCount: 10,
      cardsReadyAtMs: null,
      gridLoadingIndicators: 0,
    }),
    false,
  );

  // Cards just finished hydrating (10/10 at t=2_400), quiet window since cardsReadyAtMs not yet elapsed: must NOT settle.
  assert.equal(
    isAlarmGridHydrationSettled({
      seenObsRequests: 2,
      inFlightObsRequests: 0,
      lastObsEventMs: 1_500,
      nowMs: 2_900,
      renderedCardCount: 10,
      expectedCardCount: 10,
      cardsReadyAtMs: 2_400,
      gridLoadingIndicators: 0,
    }),
    false,
  );

  // DataGrid spinner still visible even after quiet window: must NOT settle.
  assert.equal(
    isAlarmGridHydrationSettled({
      seenObsRequests: 4,
      inFlightObsRequests: 0,
      lastObsEventMs: 2_500,
      nowMs: 3_500,
      renderedCardCount: 10,
      expectedCardCount: 10,
      cardsReadyAtMs: 2_400,
      gridLoadingIndicators: 1,
    }),
    false,
  );

  // Cards hydrated, zero in-flight requests, zero grid spinners, and >=800ms elapsed after both cardsReadyAtMs and lastObsEventMs: settled.
  assert.equal(
    isAlarmGridHydrationSettled({
      seenObsRequests: 4,
      inFlightObsRequests: 0,
      lastObsEventMs: 2_600,
      nowMs: 3_450,
      renderedCardCount: 10,
      expectedCardCount: 10,
      cardsReadyAtMs: 2_400,
      gridLoadingIndicators: 0,
    }),
    true,
  );
});

test("buildEventRowCssSelector matches both upgraded durable observationId rowKey and pre-resolution MQTT rowKey", () => {
  const mqttRowKey = "Local Node\u001fLane21\u001f2026-11-04T13:49:01.183Z\u001f2026-11-04T13:49:07.216Z";
  assert.equal(
    buildEventRowCssSelector(mqttRowKey, "0jmb179t"),
    '.MuiDataGrid-row[data-id="Local Node\u001f0jmb179t"], .MuiDataGrid-row[data-id="Local Node\u001fLane21\u001f2026-11-04T13:49:01.183Z\u001f2026-11-04T13:49:07.216Z"]',
  );

  // Already-durable REST rowKey does not duplicate the selector
  assert.equal(
    buildEventRowCssSelector("Local Node\u001f0jmb179t", "0jmb179t"),
    '.MuiDataGrid-row[data-id="Local Node\u001f0jmb179t"]',
  );
});

test("extractConSysNextPath rewrites upstream proxy origins onto relative /sensorhub/api/ paths and rejects off-API links", () => {
  assert.equal(
    extractConSysNextPath([
      {rel: "self", href: "http://192.0.2.57:8282/sensorhub/api/datastreams?limit=1000"},
      {rel: "next", href: "http://192.0.2.57:8282/sensorhub/api/datastreams?limit=1000&offset=1000"},
    ]),
    "/sensorhub/api/datastreams?limit=1000&offset=1000",
  );
  assert.equal(
    extractConSysNextPath([{rel: "next", href: "/sensorhub/api/systems?limit=500&offset=500"}]),
    "/sensorhub/api/systems?limit=500&offset=500",
  );
  assert.equal(
    extractConSysNextPath([{rel: "next", href: "https://example.invalid/other/path?offset=1000"}]),
    null,
  );
  assert.equal(extractConSysNextPath([{rel: "prev", href: "/sensorhub/api/datastreams?offset=0"}]), null);
  assert.equal(extractConSysNextPath(undefined), null);
});

test("collectConSysPaginatedItems gathers all datastream pages across >1000-stream 50-lane + multi-camera topologies", async () => {
  const seenPaths: string[] = [];
  const items = await collectConSysPaginatedItems<{id: string; lane: string}>(
    "/sensorhub/api/datastreams?limit=1000",
    async (path) => {
      seenPaths.push(path);
      if (path === "/sensorhub/api/datastreams?limit=1000") {
        return {
          items: [
            {id: "ds-lane01", lane: "Lane01"},
            {id: "ds-lane47", lane: "Lane47"},
          ],
          links: [{rel: "next", href: "http://192.0.2.57:8282/sensorhub/api/datastreams?limit=1000&offset=1000"}],
        };
      }
      if (path === "/sensorhub/api/datastreams?limit=1000&offset=1000") {
        return {
          items: [
            {id: "ds-lane13", lane: "Lane13"},
            {id: "ds-lane18", lane: "Lane18"},
            {id: "ds-lane28", lane: "Lane28"},
          ],
        };
      }
      throw new Error(`Unexpected path ${path}`);
    },
  );

  assert.deepEqual(seenPaths, [
    "/sensorhub/api/datastreams?limit=1000",
    "/sensorhub/api/datastreams?limit=1000&offset=1000",
  ]);
  assert.deepEqual(
    items.map((item) => item.lane),
    ["Lane01", "Lane47", "Lane13", "Lane18", "Lane28"],
  );
});

test("collectConSysPaginatedItems stops on duplicate next links and fails closed when maxPages is exceeded", async () => {
  const loopItems = await collectConSysPaginatedItems<number>(
    "/sensorhub/api/datastreams?limit=10",
    async () => ({
      items: [1],
      links: [{rel: "next", href: "/sensorhub/api/datastreams?limit=10"}],
    }),
  );
  assert.deepEqual(loopItems, [1]);

  await assert.rejects(
    () =>
      collectConSysPaginatedItems<number>(
        "/sensorhub/api/datastreams?limit=1&offset=0",
        async (path) => {
          const offset = Number(new URL(path, "https://oscar.invalid").searchParams.get("offset") ?? "0");
          return {
            items: [offset],
            links: [{rel: "next", href: `/sensorhub/api/datastreams?limit=1&offset=${offset + 1}`}],
          };
        },
        3,
      ),
    /exceeded maxPages=3/,
  );
});

test("assessPageZeroRefillAfterAdjudication requires Page 0 to refill from Page 1+ when totalCount > pageSize", () => {
  // 40 total alarms, 2 bulk-adjudicated -> Page 0 must refill back to 15 rows (not shrink to 13)
  const refilled = assessPageZeroRefillAfterAdjudication({
    totalCountBefore: 40,
    adjudicatedCount: 2,
    visibleRowsAfter: 15,
  });
  assert.equal(refilled.passed, true);
  assert.equal(refilled.expectedVisibleOnPageZero, 15);

  const drained = assessPageZeroRefillAfterAdjudication({
    totalCountBefore: 40,
    adjudicatedCount: 2,
    visibleRowsAfter: 13,
  });
  assert.equal(drained.passed, false);

  // When only 8 total alarms exist and 1 is adjudicated, 7 visible rows is expected
  const smallTable = assessPageZeroRefillAfterAdjudication({
    totalCountBefore: 8,
    adjudicatedCount: 1,
    visibleRowsAfter: 7,
  });
  assert.equal(smallTable.passed, true);
  assert.equal(smallTable.expectedVisibleOnPageZero, 7);
});

test("assessPageZeroReturnCutoffPreservation verifies cutoff advancement and new alarm visibility after Page 1 -> Page 0 return", () => {
  const initialCutoff = "2026-11-08T12:00:00.000Z";
  const arrivalTime = "2026-11-08T12:05:00.000Z";
  const advancedCutoff = "2026-11-08T12:05:02.000Z";

  const preserved = assessPageZeroReturnCutoffPreservation({
    initialCutoffIso: initialCutoff,
    liveArrivalTimeIso: arrivalTime,
    returnedPageZeroQueryUrls: [
      `https://oscar.invalid/sensorhub/api/observations?resultTime=..%2F${encodeURIComponent(advancedCutoff)}&offset=0&limit=15`,
    ],
    renderedRowsOnReturn: [makeRow("Lane03", "777", "Neutron"), makeRow("Lane01", "100", "Gamma")],
    expectedArrival: {laneId: "Lane03", occupancyCount: "777"},
  });
  assert.equal(preserved.passed, true);
  assert.equal(preserved.cutoffAdvanced, true);
  assert.equal(preserved.arrivalVisibleOnPageZero, true);

  // Stale mount-time cutoff fails
  const stale = assessPageZeroReturnCutoffPreservation({
    initialCutoffIso: initialCutoff,
    liveArrivalTimeIso: arrivalTime,
    returnedPageZeroQueryUrls: [
      `https://oscar.invalid/sensorhub/api/observations?resultTime=..%2F${encodeURIComponent(initialCutoff)}&offset=0&limit=15`,
    ],
    renderedRowsOnReturn: [makeRow("Lane01", "100", "Gamma")],
    expectedArrival: {laneId: "Lane03", occupancyCount: "777"},
  });
  assert.equal(stale.passed, false);
  assert.equal(stale.cutoffAdvanced, false);
  assert.equal(stale.arrivalVisibleOnPageZero, false);
});
