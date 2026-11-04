import assert from "node:assert/strict";
import {resolve} from "node:path";
import test from "node:test";
import {loadLaneConfigOracle, REQUIRED_OPERATIONAL_VIEW_KEYS} from "../src/lane-config.js";
import {
  assessPageZeroAlarmVisibility,
  assessScopedViewIsolation,
  buildCycleExecutionPlan,
  compareAlarmsByViewerPriority,
  DEFAULT_OPERATOR_RECYCLE_CYCLES,
  deriveAlarmStatusFromResult,
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
