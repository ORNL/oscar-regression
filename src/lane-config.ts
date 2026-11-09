import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

export const OSCAR_LANE_CONFIG_BASE_HEADERS = [
  "Name", "UniqueID", "AutoStart", "Latitude", "Longitude", "OperationalViews",
  "RPMConfigType", "RPMHost", "RPMPort", "AspectAddressStart", "AspectAddressEnd",
  "EMLEnabled", "EMLCollimated", "LaneWidth",
] as const;

export const OSCAR_LANE_CONFIG_HEADERS = [
  ...OSCAR_LANE_CONFIG_BASE_HEADERS,
  "CameraType0", "CameraHost0", "CameraPath0", "Codec0", "Username0", "Password0",
] as const;

export function expectedLaneConfigHeaders(cameraGroupCount = 1): string[] {
  const count = Math.max(1, Math.trunc(cameraGroupCount));
  const headers: string[] = [...OSCAR_LANE_CONFIG_BASE_HEADERS];
  for (let index = 0; index < count; index++) {
    headers.push(
      `CameraType${index}`,
      `CameraHost${index}`,
      `CameraPath${index}`,
      `Codec${index}`,
      `Username${index}`,
      `Password${index}`,
    );
  }
  return headers;
}

export const REQUIRED_OPERATIONAL_VIEW_KEYS = [
  "east-gate", "west-gate", "north-gate", "south-gate", "pedestrian", "entrance", "exit",
] as const;

const OPERATIONAL_VIEW_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PRIMARY_VIEW_KEYS = new Set(["east-gate", "west-gate", "north-gate", "south-gate", "pedestrian"]);
const DIRECTION_VIEW_KEYS = new Set(["entrance", "exit"]);

export interface LaneConfigMembership {
  name: string;
  uniqueId: string;
  operationalViews: readonly string[];
  cameraCount?: number;
}

export interface LaneConfigOracle {
  path: string;
  sha256: string;
  lanes: readonly LaneConfigMembership[];
  lanesByView: ReadonlyMap<string, readonly string[]>;
  configuredCameraCount?: number;
}

function parseCsv(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < contents.length; index++) {
    const character = contents[index] ?? "";
    if (quoted) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell) throw new Error("Lane configuration contains a quote inside an unquoted field");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && contents[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("Lane configuration contains an unterminated quoted field");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((fields) => fields.some((field) => field !== ""));
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function loadLaneConfigOracle(path: string): LaneConfigOracle {
  let rawContents: Buffer;
  try {
    rawContents = readFileSync(path);
  } catch (error) {
    throw new Error(`Unable to read OSCAR_LANE_CONFIG_PATH ${path}`, {cause: error});
  }
  const contents = rawContents.toString("utf8").replace(/^\uFEFF/, "");

  const rows = parseCsv(contents);
  const header = rows.shift();
  const baseCount = OSCAR_LANE_CONFIG_BASE_HEADERS.length;
  const cameraGroupCount = header && header.length >= OSCAR_LANE_CONFIG_HEADERS.length &&
      (header.length - baseCount) % 6 === 0
    ? (header.length - baseCount) / 6
    : 0;
  if (!header || cameraGroupCount < 1 || !sameValues(header, expectedLaneConfigHeaders(cameraGroupCount))) {
    throw new Error(
      `OSCAR_LANE_CONFIG_PATH must use the exact ${OSCAR_LANE_CONFIG_HEADERS.length}-column header ` +
      `(or ${baseCount}+6*N multi-camera header): ` +
      OSCAR_LANE_CONFIG_HEADERS.join(","),
    );
  }
  if (!rows.length) throw new Error("OSCAR_LANE_CONFIG_PATH contains no lane rows");

  const names = new Set<string>();
  const uniqueIds = new Set<string>();
  const mutableByView = new Map<string, string[]>();
  let configuredCameraCount = 0;
  const lanes = rows.map((fields, rowIndex): LaneConfigMembership => {
    const rowNumber = rowIndex + 2;
    if (fields.length !== header.length) {
      throw new Error(
        `OSCAR_LANE_CONFIG_PATH row ${rowNumber} has ${fields.length} columns; expected ${header.length}`,
      );
    }

    const name = fields[0]?.trim() ?? "";
    const uniqueId = fields[1]?.trim() ?? "";
    if (!name || !uniqueId) throw new Error(`OSCAR_LANE_CONFIG_PATH row ${rowNumber} requires Name and UniqueID`);
    if (names.has(name)) throw new Error(`OSCAR_LANE_CONFIG_PATH contains duplicate lane name ${name}`);
    if (uniqueIds.has(uniqueId)) throw new Error(`OSCAR_LANE_CONFIG_PATH contains duplicate UniqueID ${uniqueId}`);
    names.add(name);
    uniqueIds.add(uniqueId);

    const rawViews = fields[5]?.trim() ?? "";
    const operationalViews = rawViews ? rawViews.split(";").map((value) => value.trim()) : [];
    if (operationalViews.some((value) => !value || !OPERATIONAL_VIEW_KEY_PATTERN.test(value))) {
      throw new Error(`OSCAR_LANE_CONFIG_PATH row ${rowNumber} contains an invalid OperationalViews key`);
    }
    if (new Set(operationalViews).size !== operationalViews.length) {
      throw new Error(`OSCAR_LANE_CONFIG_PATH row ${rowNumber} contains a duplicate OperationalViews key`);
    }
    for (const view of operationalViews) {
      mutableByView.set(view, [...(mutableByView.get(view) ?? []), name]);
    }
    let cameraCount = 0;
    for (let groupIndex = 0; groupIndex < cameraGroupCount; groupIndex++) {
      const cameraType = fields[baseCount + groupIndex * 6]?.trim() ?? "";
      const cameraHost = fields[baseCount + groupIndex * 6 + 1]?.trim() ?? "";
      if (cameraType && cameraHost) {
        cameraCount++;
      }
    }
    configuredCameraCount += cameraCount;
    return {name, uniqueId, operationalViews, cameraCount};
  });

  return {
    path,
    sha256: createHash("sha256").update(rawContents).digest("hex"),
    lanes,
    lanesByView: new Map([...mutableByView].map(([key, laneNames]) => [key, [...laneNames].sort()])),
    configuredCameraCount,
  };
}

export function assertCanonicalOperationalViewOracle(
  oracle: LaneConfigOracle,
  expectedLaneCount: number,
): void {
  if (oracle.lanes.length !== expectedLaneCount) {
    throw new Error(
      `OSCAR_LANE_CONFIG_PATH has ${oracle.lanes.length} lanes; EXPECTED_LANE_COUNT is ${expectedLaneCount}`,
    );
  }
  if (expectedLaneCount !== 50) {
    throw new Error(`The canonical operational-view fixture requires EXPECTED_LANE_COUNT=50; found ${expectedLaneCount}`);
  }

  const actualKeys = [...oracle.lanesByView.keys()].sort();
  const requiredKeys = [...REQUIRED_OPERATIONAL_VIEW_KEYS].sort();
  if (!sameValues(actualKeys, requiredKeys)) {
    throw new Error(
      `OSCAR_LANE_CONFIG_PATH operational views must be exactly ${requiredKeys.join(", ")}; found ${actualKeys.join(", ")}`,
    );
  }

  for (const lane of oracle.lanes) {
    const primary = lane.operationalViews.filter((key) => PRIMARY_VIEW_KEYS.has(key));
    const direction = lane.operationalViews.filter((key) => DIRECTION_VIEW_KEYS.has(key));
    if (lane.operationalViews.length !== 2 || primary.length !== 1 || direction.length !== 1) {
      throw new Error(
        `OSCAR_LANE_CONFIG_PATH lane ${lane.name} must belong to exactly one gate/pedestrian view and one entrance/exit view`,
      );
    }
  }

  const primaryBlocks = ["east-gate", "west-gate", "north-gate", "south-gate", "pedestrian"];
  oracle.lanes.forEach((lane, index) => {
    const number = index + 1;
    const suffix = String(number).padStart(2, "0");
    const expectedName = `Lane${suffix}`;
    const expectedUniqueId = `lane-${suffix}`;
    const expectedPrimary = primaryBlocks[Math.floor(index / 10)] ?? "";
    const expectedDirection = index % 10 < 5 ? "entrance" : "exit";
    if (lane.name !== expectedName || lane.uniqueId !== expectedUniqueId) {
      throw new Error(
        `OSCAR_LANE_CONFIG_PATH row ${number + 1} must identify ${expectedName}/${expectedUniqueId}; ` +
        `found ${lane.name}/${lane.uniqueId}`,
      );
    }
    if (!sameValues(lane.operationalViews, [expectedPrimary, expectedDirection])) {
      throw new Error(
        `OSCAR_LANE_CONFIG_PATH lane ${lane.name} must list OperationalViews as ` +
        `${expectedPrimary};${expectedDirection}; found ${lane.operationalViews.join(";")}`,
      );
    }
  });

  for (const key of REQUIRED_OPERATIONAL_VIEW_KEYS) {
    const expected = key === "entrance" || key === "exit" ? expectedLaneCount / 2 : expectedLaneCount / 5;
    const actual = oracle.lanesByView.get(key)?.length ?? 0;
    if (!Number.isInteger(expected) || actual !== expected) {
      throw new Error(`OSCAR_LANE_CONFIG_PATH view ${key} has ${actual} lanes; expected ${expected}`);
    }
  }
}
