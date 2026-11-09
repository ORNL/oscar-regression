import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";
import {
  assertCanonicalOperationalViewOracle,
  expectedLaneConfigHeaders,
  loadLaneConfigOracle,
  OSCAR_LANE_CONFIG_HEADERS,
  REQUIRED_OPERATIONAL_VIEW_KEYS,
  type LaneConfigMembership,
  type LaneConfigOracle,
} from "../src/lane-config.js";

const canonicalPath = resolve("fixtures/oscar-50-lane-config.csv");

function laneRange(first: number, last: number): string[] {
  return Array.from({length: last - first + 1}, (_, index) => `Lane${String(first + index).padStart(2, "0")}`);
}

test("canonical fixture uses the current schema and exact seven operational-view memberships", () => {
  const oracle = loadLaneConfigOracle(canonicalPath);
  assert.equal(oracle.lanes.length, 50);
  assert.equal(oracle.sha256, "3aff95bba57b38252016226debcab28a04cdeffa7e8c13e71a85ac94b4365312");
  assert.deepEqual([...oracle.lanesByView.keys()].sort(), [...REQUIRED_OPERATIONAL_VIEW_KEYS].sort());
  assert.deepEqual(oracle.lanesByView.get("east-gate"), laneRange(1, 10));
  assert.deepEqual(oracle.lanesByView.get("west-gate"), laneRange(11, 20));
  assert.deepEqual(oracle.lanesByView.get("north-gate"), laneRange(21, 30));
  assert.deepEqual(oracle.lanesByView.get("south-gate"), laneRange(31, 40));
  assert.deepEqual(oracle.lanesByView.get("pedestrian"), laneRange(41, 50));
  assert.deepEqual(oracle.lanesByView.get("entrance"), [
    ...laneRange(1, 5), ...laneRange(11, 15), ...laneRange(21, 25),
    ...laneRange(31, 35), ...laneRange(41, 45),
  ]);
  assert.deepEqual(oracle.lanesByView.get("exit"), [
    ...laneRange(6, 10), ...laneRange(16, 20), ...laneRange(26, 30),
    ...laneRange(36, 40), ...laneRange(46, 50),
  ]);
  assert.doesNotThrow(() => assertCanonicalOperationalViewOracle(oracle, 50));
});

test("canonical fixture preserves the 50-lane RPM and camera-emulator wiring", () => {
  const [header, ...rows] = readFileSync(canonicalPath, "utf8").trimEnd().split(/\r?\n/);
  assert.equal(header, OSCAR_LANE_CONFIG_HEADERS.join(","));
  assert.equal(rows.length, 50);
  rows.forEach((row, index) => {
    const cells = row.split(",");
    const suffix = String(index + 1).padStart(2, "0");
    assert.equal(cells.length, 20);
    assert.equal(cells[0], `Lane${suffix}`);
    assert.equal(cells[1], `lane-${suffix}`);
    assert.equal(cells[2], "true");
    assert.equal(cells[6], "Rapiscan");
    assert.equal(cells[7], "192.168.0.122");
    assert.equal(cells[8], String(10_001 + index));
    assert.equal(cells[11], "true");
    assert.equal(cells[12], "true");
    assert.equal(cells[13], "4.82");
    assert.equal(cells[14], "Custom");
    assert.equal(cells[15], "192.168.0.55:8554");
    assert.equal(cells[16], `/cam_${suffix}`);
    assert.deepEqual(cells.slice(17), ["", "", ""]);
  });
});

function replacingLane(
  oracle: LaneConfigOracle,
  index: number,
  replacement: Partial<LaneConfigMembership>,
): LaneConfigOracle {
  return {
    ...oracle,
    lanes: oracle.lanes.map((lane, laneIndex) => laneIndex === index ? {...lane, ...replacement} : lane),
  };
}

test("canonical oracle rejects wrong identities, key order, and block membership", () => {
  const oracle = loadLaneConfigOracle(canonicalPath);
  assert.throws(
    () => assertCanonicalOperationalViewOracle(replacingLane(oracle, 0, {name: "Lane1"}), 50),
    /must identify Lane01\/lane-01/,
  );
  assert.throws(
    () => assertCanonicalOperationalViewOracle(replacingLane(oracle, 0, {uniqueId: "lane01"}), 50),
    /must identify Lane01\/lane-01/,
  );
  assert.throws(
    () => assertCanonicalOperationalViewOracle(
      replacingLane(oracle, 0, {operationalViews: ["entrance", "east-gate"]}), 50,
    ),
    /must list OperationalViews as east-gate;entrance/,
  );
  assert.throws(
    () => assertCanonicalOperationalViewOracle(
      replacingLane(oracle, 0, {operationalViews: ["west-gate", "entrance"]}), 50,
    ),
    /must list OperationalViews as east-gate;entrance/,
  );
});

test("lane configuration parser rejects stale headers and malformed memberships", () => {
  const root = mkdtempSync(join(tmpdir(), "oscar-lane-config-"));
  const stale = join(root, "stale.csv");
  writeFileSync(stale, "Name,UniqueID\nLane01,lane-01\n");
  assert.throws(() => loadLaneConfigOracle(stale), /exact 20-column header/);

  const duplicate = join(root, "duplicate.csv");
  writeFileSync(duplicate, `${OSCAR_LANE_CONFIG_HEADERS.join(",")}\n` +
    "Lane01,lane-01,true,1,1,east-gate;east-gate,Rapiscan,host,10001,,,true,true,4.82,Custom,camera,/cam_01,,,\n");
  assert.throws(() => loadLaneConfigOracle(duplicate), /duplicate OperationalViews key/);
});

test("lane configuration checksum fingerprints the exact file bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "oscar-lane-config-bom-"));
  const path = join(root, "bom.csv");
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    readFileSync(canonicalPath),
  ]);
  writeFileSync(path, bytes);
  const oracle = loadLaneConfigOracle(path);
  assert.equal(oracle.lanes.length, 50);
  assert.equal(oracle.configuredCameraCount, 50);
  assert.equal(oracle.sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("lane configuration parser supports multi-camera CSV headers (e.g. 3 cameras on Lane03) and counts configured cameras", () => {
  const root = mkdtempSync(join(tmpdir(), "oscar-lane-config-multicam-"));
  const multiPath = join(root, "lanes-52-cameras.csv");
  const [_origHeader, ...origRows] = readFileSync(canonicalPath, "utf8").trimEnd().split(/\r?\n/);
  const header3 = expectedLaneConfigHeaders(3).join(",");
  const rows3 = origRows.map((row, idx) => {
    if (idx === 2) {
      // Lane03 with Camera0 (emulator) + Camera1 (Axis default) + Camera2 (Axis RTSP)
      return `${row},Axis,192.168.0.188,,H264,user,pass,Custom,192.168.0.188:554,/axis-media/media.amp?videocodec=h264,H264,user,pass`;
    }
    return `${row},,,,,,,,,,,,`;
  });
  writeFileSync(multiPath, `${[header3, ...rows3].join("\n")}\n`);

  const oracle = loadLaneConfigOracle(multiPath);
  assert.equal(oracle.lanes.length, 50);
  assert.equal(oracle.configuredCameraCount, 52);
  assert.equal(oracle.lanes[0]?.cameraCount, 1);
  assert.equal(oracle.lanes[2]?.name, "Lane03");
  assert.equal(oracle.lanes[2]?.cameraCount, 3);
  assert.doesNotThrow(() => assertCanonicalOperationalViewOracle(oracle, 50));
});
