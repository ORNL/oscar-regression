import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDashboardConnectionResolution,
  assessDashboardKnownClearTamper,
  assessHealthObservationBatches,
  connectionDataStreamIds,
  DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS,
  DASHBOARD_HEALTH_MAX_BATCH_STREAMS,
  DASHBOARD_HEALTH_MAX_IN_FLIGHT,
  expectedDashboardConnectionIds,
  forceConnectionObservationsOffline,
  forceSingleConnectionObservationOffline,
  guardDashboardHealthFixtureRoute,
  healthRowHasRpmConnectionState,
  parseHealthObservationBatch,
} from "../src/dashboard-health.js";

test("dashboard fixture route records a bounded fetch rejection without rethrowing", async () => {
  assert.equal(DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS, 30_000);
  const timeout = new Error("route.fetch timed out");
  let observed: unknown;
  let aborts = 0;
  const completed = await guardDashboardHealthFixtureRoute(
    async () => { throw timeout; },
    (error) => { observed = error; },
    async () => { aborts++; },
  );
  assert.equal(completed, false);
  assert.equal(observed, timeout);
  assert.equal(aborts, 1);

  const abortFailureStillContained = await guardDashboardHealthFixtureRoute(
    async () => { throw timeout; },
    () => undefined,
    async () => { throw new Error("request already closed"); },
  );
  assert.equal(abortFailureStillContained, false);
});

test("Status-of-Health RPM oracle cannot be satisfied by a camera state", () => {
  const reconnecting = "Lane50 Local Node RPM (Lane50 - RPM) · Offline " +
    "Lane50 - Camera 0 · Online Gamma high: Clear";
  assert.equal(healthRowHasRpmConnectionState(reconnecting, "online"), false);
  assert.equal(healthRowHasRpmConnectionState(reconnecting, "offline"), true);
  assert.equal(healthRowHasRpmConnectionState(
    reconnecting.replace("RPM (Lane50 - RPM) · Offline", "RPM (Lane50 - RPM) · Online"),
    "online",
  ), true);
});

test("dashboard health batches enforce the ten-stream and two-request contract", () => {
  assert.equal(DASHBOARD_HEALTH_MAX_BATCH_STREAMS, 10);
  assert.equal(DASHBOARD_HEALTH_MAX_IN_FLIGHT, 2);
  const ten = Array.from({length: 10}, (_, index) => `stream-${index + 1}`);
  assert.deepEqual(
    assessHealthObservationBatches([{streamIds: ten, limit: 10}], 50, 2),
    {passed: true, validSizes: true, shared: true, boundedConcurrency: true},
  );
  assert.deepEqual(
    assessHealthObservationBatches([{streamIds: [...ten, "stream-11"], limit: 11}], 50, 2),
    {passed: false, validSizes: false, shared: true, boundedConcurrency: true},
  );
  assert.equal(assessHealthObservationBatches([{streamIds: ten, limit: 10}], 50, 3).passed, false);
  assert.equal(assessHealthObservationBatches([], 50, 0).passed, false);
});

test("dashboard connection oracle requires every exact expected chip to resolve accessibly", () => {
  const expected = expectedDashboardConnectionIds(["Lane01", "Lane02"], true);
  assert.deepEqual(expected, [
    "lane-health-Lane01-rpm", "lane-health-Lane01-camera",
    "lane-health-Lane02-rpm", "lane-health-Lane02-camera",
  ]);
  const online = expected.map((testId) => ({testId, state: "online", label: `${testId} Online`}));
  assert.deepEqual(assessDashboardConnectionResolution(online, expected), {
    passed: true,
    online: 4,
    missing: [],
    unexpected: [],
    duplicates: [],
    unresolved: [],
  });

  const unresolved = online.map((snapshot) => ({...snapshot}));
  unresolved[2] = {...unresolved[2]!, state: "unknown", label: "RPM Unknown"};
  const unresolvedAssessment = assessDashboardConnectionResolution(unresolved, expected);
  assert.equal(unresolvedAssessment.passed, false);
  assert.deepEqual(unresolvedAssessment.unresolved, ["lane-health-Lane02-rpm:unknown"]);

  const wrongIdentity = [...online.slice(0, -1), {
    testId: "lane-health-Lane99-camera", state: "online", label: "Camera Online",
  }];
  const wrongAssessment = assessDashboardConnectionResolution(wrongIdentity, expected);
  assert.equal(wrongAssessment.passed, false);
  assert.deepEqual(wrongAssessment.missing, ["lane-health-Lane02-camera"]);
  assert.deepEqual(wrongAssessment.unexpected, ["lane-health-Lane99-camera"]);

  const duplicateAssessment = assessDashboardConnectionResolution([...online, online[0]!], expected);
  assert.equal(duplicateAssessment.passed, false);
  assert.deepEqual(duplicateAssessment.duplicates, ["lane-health-Lane01-rpm"]);

  const multiCamExpectedRpms = expectedDashboardConnectionIds(["Lane01", "Lane02"], false);
  const dualCamOnline = [
    {testId: "lane-health-Lane01-rpm", componentId: "rpm-1", state: "online", label: "RPM Online"},
    {testId: "lane-health-Lane01-camera", componentId: "cam-1a", state: "online", label: "Cam 0 Online"},
    {testId: "lane-health-Lane01-camera", componentId: "cam-1b", state: "online", label: "Cam 1 Online"},
    {testId: "lane-health-Lane02-rpm", componentId: "rpm-2", state: "online", label: "RPM Online"},
    {testId: "lane-health-Lane02-camera", componentId: "cam-2a", state: "online", label: "Cam 0 Online"},
  ];
  assert.deepEqual(assessDashboardConnectionResolution(dualCamOnline, multiCamExpectedRpms, 3), {
    passed: true,
    online: 5,
    missing: [],
    unexpected: [],
    duplicates: [],
    unresolved: [],
  });
  const duplicateComponentAssessment = assessDashboardConnectionResolution([
    dualCamOnline[0]!,
    dualCamOnline[1]!,
    {...dualCamOnline[2]!, componentId: "cam-1a"},
    dualCamOnline[3]!,
    dualCamOnline[4]!,
  ], multiCamExpectedRpms, 3);
  assert.equal(duplicateComponentAssessment.passed, false);
  assert.deepEqual(duplicateComponentAssessment.duplicates, ["lane-health-Lane01-camera"]);
});

test("dashboard Tamper baseline requires every lane card and no fault indicator", () => {
  const lanes = ["Lane01", "Lane02", "Lane03"];
  assert.deepEqual(assessDashboardKnownClearTamper(lanes, [], 3), {
    passed: true,
    laneCount: 3,
    uniqueLaneCount: 3,
    clearCount: 3,
    unknownLaneIds: [],
    activeLaneIds: [],
    invalidLaneIds: [],
  });

  const unknown = assessDashboardKnownClearTamper(lanes, [{
    laneId: "Lane02",
    state: "unknown",
    label: "Tamper: Unknown",
  }], 3);
  assert.equal(unknown.passed, false);
  assert.equal(unknown.clearCount, 2);
  assert.deepEqual(unknown.unknownLaneIds, ["Lane02"]);

  const active = assessDashboardKnownClearTamper(lanes, [{
    laneId: "Lane03",
    state: "active",
    label: "Tamper: Fault",
  }], 3);
  assert.equal(active.passed, false);
  assert.deepEqual(active.activeLaneIds, ["Lane03"]);
});

test("dashboard Tamper baseline rejects missing, duplicate, or malformed lane state", () => {
  assert.equal(assessDashboardKnownClearTamper(["Lane01", "Lane01"], [], 2).passed, false);
  const invalid = assessDashboardKnownClearTamper(["Lane01", "Lane02"], [{
    laneId: "Lane99",
    state: "clear",
    label: "Tamper: Clear",
  }], 2);
  assert.equal(invalid.passed, false);
  assert.deepEqual(invalid.invalidLaneIds, ["Lane99"]);
});

test("health polling parser recognizes only batched latest-observation queries", () => {
  assert.deepEqual(
    parseHealthObservationBatch(
      "https://oscar.test/sensorhub/api/observations?resultTime=latest&dataStream=one,two,three&offset=0&limit=3",
    ),
    {streamIds: ["one", "two", "three"], limit: 3},
  );
  assert.deepEqual(
    parseHealthObservationBatch(
      "https://oscar.test/sensorhub/api/observations/?dataStream=one%2Ctwo&resultTime=LATEST&limit=2",
    ),
    {streamIds: ["one", "two"], limit: 2},
  );
  assert.equal(parseHealthObservationBatch("not a URL"), null);
  assert.equal(parseHealthObservationBatch(
    "https://oscar.test/sensorhub/api/observations?resultTime=latest&limit=50",
  ), null);
  assert.equal(parseHealthObservationBatch(
    "https://oscar.test/sensorhub/api/observations?resultTime=now&dataStream=one&limit=1",
  ), null);
  assert.equal(parseHealthObservationBatch(
    "https://oscar.test/sensorhub/api/datastreams?resultTime=latest&dataStream=one&limit=1",
  ), null);
});

test("offline fixture rewrites top-level and parsed connection results only", () => {
  const payload = {
    items: [
      {id: "rpm", result: {isConnected: true}},
      {id: "camera-online", properties: {result: {connection: true}}},
      {id: "camera-offline", result: {isConnected: false}},
      {id: "gamma", result: {countRate: 10, alarmState: "Background"}},
    ],
  };

  assert.equal(forceConnectionObservationsOffline(payload), 3);
  assert.equal(payload.items[0]?.result?.isConnected, false);
  assert.equal(payload.items[1]?.properties?.result?.connection, false);
  assert.equal(payload.items[2]?.result?.isConnected, false);
  assert.deepEqual(payload.items[3]?.result, {countRate: 10, alarmState: "Background"});
  assert.equal(forceConnectionObservationsOffline([]), 0);
  assert.equal(forceConnectionObservationsOffline({items: "not-an-array"}), 0);
});

test("mixed fixture makes only the selected connection datastream offline", () => {
  const payload = {
    items: [
      {"datastream@id": "rpm-connection", result: {isConnected: false}},
      {"datastream@id": "camera-east-connection", result: {isConnected: true}},
      {
        properties: {
          "datastream@id": "camera-west-connection",
          result: {connection: false},
        },
      },
      {"datastream@id": "gamma", result: {alarmState: "Background"}},
    ],
  };

  assert.deepEqual(
    forceSingleConnectionObservationOffline(payload, "camera-east-connection"),
    {matched: 3, offlineMatched: 1},
  );
  assert.equal(payload.items[0]?.result?.isConnected, true);
  assert.equal(payload.items[1]?.result?.isConnected, false);
  assert.equal(payload.items[2]?.properties?.result?.connection, true);
  assert.deepEqual(payload.items[3]?.result, {alarmState: "Background"});
  assert.deepEqual(
    forceSingleConnectionObservationOffline({items: []}, "missing"),
    {matched: 0, offlineMatched: 0},
  );
});

test("mixed fixture is order-independent and keeps both connection fields consistent", () => {
  const payload = {
    items: [
      {"datastream@id": "tamper", result: {tamperStatus: true}},
      {"datastream@id": "camera-other", result: {isConnected: false, connection: false}},
      {
        properties: {
          "datastream@id": "camera-target",
          result: {isConnected: true, connection: true},
        },
      },
    ],
  };

  assert.deepEqual(
    forceSingleConnectionObservationOffline(payload, "camera-target"),
    {matched: 2, offlineMatched: 1},
  );
  assert.deepEqual(payload.items[0]?.result, {tamperStatus: true});
  assert.deepEqual(payload.items[1]?.result, {isConnected: true, connection: true});
  assert.deepEqual(payload.items[2]?.properties?.result, {isConnected: false, connection: false});

  assert.deepEqual(
    forceSingleConnectionObservationOffline(payload, "missing-target"),
    {matched: 2, offlineMatched: 0},
  );
  assert.deepEqual(payload.items[1]?.result, {isConnected: true, connection: true});
  assert.deepEqual(payload.items[2]?.properties?.result, {isConnected: true, connection: true});
});

test("connection datastream discovery accepts raw and parser-wrapped metadata", () => {
  const radConnection = "http://www.opengis.net/def/ConnectionStatus";
  const ogcConnection = "http://www.opengis.net/def/property/OGC/0/ConnectionStatus";
  assert.deepEqual(connectionDataStreamIds({
    items: [
      {
        id: "camera-east",
        observedProperties: [{definition: radConnection}],
        properties: {manufacturer: "example"},
      },
      {properties: {id: "camera-west", observedProperties: [{definition: ogcConnection}]}},
      {id: "duplicate", observedProperties: [{definition: radConnection}]},
      {id: "duplicate", observedProperties: [{definition: radConnection}]},
      {id: "gamma", observedProperties: [{definition: "http://www.opengis.net/def/Alarm"}]},
      {id: "missing-definitions"},
    ],
  }), ["camera-east", "camera-west", "duplicate"]);
  assert.deepEqual(connectionDataStreamIds({items: "not-an-array"}), []);
});
