# OSCAR Regression Suite

End-to-end regression testing for an OSCAR test deployment. The suite drives the
real OSCAR Viewer, SensorHub Admin UI, and RPM emulator; injects controlled
faults and alarms; validates adjudication and reporting; and emits machine-readable
correctness and performance results.

The harness was first validated against OSCAR 3.9.1 and the 50-lane emulator
site. General target and workflow selection is configuration-driven. Each new
storage release contract remains deliberately version-pinned and requires a
source review before the suite can certify that version.

> **Test environments only.** The `full` profile stops and restarts the reserved
> RPM, temporarily replaces its configuration, forces connection and fault
> transitions, creates alarm occupancies (including one over a minute), and
> submits a Code 9 adjudication. OSCAR event and audit history created by a run is
> permanent. Cleanup restores emulator state but does not delete OSCAR history.
> Never run `full` against production. Acknowledgement variables are safety
> interlocks, not authorization.

## What it validates

- authenticated Viewer access, navigation, map, national statistics, and servers
- browser-cache policy for private immutable hashed Viewer bundles, revalidated
  service-worker code, and non-cacheable anonymous authentication errors
- SensorHub Admin visibility
- every configured lane and camera on Status of Health
- compact Dashboard health indicators for every lane, with independent RPM and
  per-camera connectivity; gamma-high/low, neutron-high, tamper, and extended-
  occupancy states; an explicit known-clear Tamper baseline for every emulated
  RPM/lane; operational-view membership; keyboard navigation; and bounded
  shared health requests
- RPM disconnect/reconnect, gamma-high, gamma-low, neutron-high, tamper, and
  extended-occupancy detection and recovery
- live Gamma and Neutron plot data after Dashboard-to-Lane Details navigation,
  plus HLS camera playback, decoded dimensions, and advancing playback time
- back-to-back one-second gamma/neutron alarm occupancies that exercise a short
  CLOSE behind the keyframe-gated camera OPEN, with a count-only OSCAR log gate
  rejecting camera-command timeout, quarantine, result-timeout, rejection, and
  stale-generation symptoms; alarm ingestion and full-database lane/date event
  filtering through authenticated count-and-page oracles, including the
  Dashboard's unadjudicated-alarm predicate after generated alarms exist;
  exact generated public observation-ID-to-video association with one unique
  generation-qualified MP4 per authoritative OSH lane-camera UID, nonzero source
  objects, and browser-loaded MP4 metadata
- occupancy “Event UUID” display, search, fresh direct links, not-found handling,
  operational-view-preserving member lookup and non-member fail-closed behavior,
  and exact public observation ID preservation in printable PDFs and truncated QR exports
- offline alarm JSON export/import and SHA-256 validation, including visible
  series-color chart redraw and canonical payload/integrity/transport validation
  when the received package is downloaded again
- deterministic Alarm Transfer camera scanning, lifecycle cleanup, permission
  failure/retry, and exported QR PNG image import
- full adjudication, confirmation, and audit-history display
- continuous never-reloaded Wallboard Watcher + PWA Service Worker notification +
  scoped/unscoped full Adjudication UI endurance testing
  (`scripts/run-ui-endurance.sh`; see [`docs/UI_ENDURANCE.md`](docs/UI_ENDURANCE.md))
- site, lane, event, state-of-health, and adjudication PDF reports
- exact membership for all five location and both direction operational views,
  Health-navigation query persistence, and malformed/unassigned inputs failing closed
- runner and OSCAR container CPU, memory, PID, restart, OOM, load, and available
  host-memory samples
- OSCAR 3.9.2 exact-five retained JPEG API/gallery, including generated-alarm
  self-seeding by exact public observation ID in a full run, manifest/source binding,
  one-attempt successful retention ledgers, and
  run-baselined orphan/partial rejection; bounded catalog/frame
  transfers and event resource budgets, baseline-JPEG structure plus Chromium
  decode/dimension checks for every frame, lazy selected-frame requests, and
  legacy-video fallback;
  schema-2 metadata checkpoint and compact five-minute processed/deletion index
  health; exact direct daily-file config, live lane-UID append, hardened
  publication manifests, and restart durability; archive catalog, exact schema
  v5 checksum, bounded DuckDB resources and scratch cleanup, parity, portable
  export, exact cold-ID and mixed attached-hot/Parquet-cold queries, natural
  whole-child retirement with zero raw-row DELETEs, and authenticated
  coordinated-backup controls, retained-media
  inclusion, scratch exclusion, and daily-journal receipts;
  exact application/PostGIS/gateway tags, immutable running image IDs,
  available repository digests, OCI labels, checksum, the archive root marker and
  optional single-mode backup marker, stable lock rejection, inactive PostgreSQL
  WAL archiving with no external bind, packaged helper hashes/behavior, and compiled archive/backup
  publisher source provenance plus first-publish/collision-preservation behavior, no archive
  partial artifacts, no full-backup-root mount in either long-running service,
  isolated one-shot base-backup wiring, exact-row activation under a
  controlled source-change race, PostgreSQL checksums, `pg_stat_statements`, and
  observation batch/resource counters

See [docs/COVERAGE.md](docs/COVERAGE.md) for the detailed matrix and intentional
exclusions.

The smoke profile requires live Online observations for every configured RPM
and camera. It also reads every emulator RPM's modeled `tamper_fault` value and
requires an explicit `false` value plus a corresponding known-clear Dashboard
state for every lane. The harness never treats an Online icon alone as proof that
Tamper is clear and never toggles Tamper to manufacture a passing baseline. On
each newly established RPM connection, OSCAR's Rapiscan driver must publish its
initial Tamper-clear observation before processing subsequent device `TT`/`TC`
messages. Deterministic camera Offline and Unknown checks intercept only browser
responses and do not disconnect live cameras. The full profile performs the real
reserved-RPM disconnect/reconnect and supported fault transitions.

## Safety model

`smoke` is non-fault-injecting, but it authenticates, posts a national-statistics
command, creates report bucket files, and behavior-tests the storage atomic publisher
when `storage-health` is selected. It also reads each emulator RPM's explicit
Tamper model state without changing it. `full` also changes emulator state and creates permanent,
clearly marked adjudication audit records. Full runs are refused unless
`OSCAR_TEST_TARGET_ACK` exactly matches the host in `OSCAR_BASE_URL`.
It also requires exact emulator-host and RPM-to-lane acknowledgements. Every
mutating invocation holds one host-wide, root-owned remote lease for its complete
run, including cleanup; this coordinates different runners, full runs, restore
drills, and storage-health publisher checks. Full/restore local locks remain an
additional same-runner guard.

The suite reserves one RPM (default `rpm-50` / `Lane50`), snapshots its complete
configuration, disables random occupancies, runs deterministic tests, clears all
injected faults, and restores the exact snapshot in a `finally` block. Do not run
the full profile against an operational or production lane.

Read [docs/SAFETY.md](docs/SAFETY.md) before the first full run.

## Requirements

- Node.js 20.16 or newer and npm
- Chrome/Chromium, or a Playwright-managed Chromium installation
- network access to OSCAR and the RPM emulator
- an OSCAR test account
- strict-key-checked SSH access to the OSCAR Docker host when the default
  `STORAGE_WORKFLOW=required` release gate is used; it is optional only for an
  explicit legacy/non-storage run with `STORAGE_WORKFLOW=auto` or `disabled`

## Quick start

```bash
npm ci
npm run install:browser
cp .env.example .env
chmod 600 .env
```

Edit `.env` for the test deployment. Never commit it.

After installing a new release into a versioned target directory, rebind the
private runner configuration to the one running Compose release. The command is
read-only unless `--apply` is supplied, uses strict host-key checking, verifies
the release resolves back to the running OSCAR container, and never changes
restore acknowledgements or secrets:

```bash
./scripts/rebind-active-release.sh --build-label 3.9.2-EXACT-ARTIFACT
./scripts/rebind-active-release.sh --apply --build-label 3.9.2-EXACT-ARTIFACT
```

Review the preview before applying it. This explicit rebind preserves the
storage acknowledgement as an operator interlock; regression never silently
follows a newest directory or a symlink.

Run the low-mutation smoke profile first (it does not inject RPM faults, but it
does post the national-statistics command and create report bucket files):

```bash
npm run test:smoke
```

Then run the configured full profile on an acknowledged test target:

```bash
npm run test:full
```

The destructive restore drill is deliberately not part of either command. It
has its own profile, target lock, storage acknowledgement, two explicit
canonical storage-plane paths, and four additional exact acknowledgements. Run
it only after reviewing
[docs/STORAGE_REGRESSION.md](docs/STORAGE_REGRESSION.md):

```bash
OSCAR_BACKUP_MODE=single STORAGE_WORKFLOW=required STORAGE_BACKUP_WORKFLOW=required npm run test:restore-drill
```

`STORAGE_RESTORE_PROBE_TIMEOUT_MS` is a restore-only deadline (default
`7200000`, bounded from 10 minutes through 8 hours). Ordinary storage probes
keep the tighter `STORAGE_PROBE_TIMEOUT_MS`. The restore deadline bounds the
primary SSH wait; fail-closed quiescence after that deadline can take longer.
An atomically pre-armed launch gate prevents a delayed SSH command from starting
after cancellation. If the deadline is reached, the runner keeps the exact
disruption phase active and waits until the privileged remote wrapper publishes
a terminal status and its exact probe-session PID/start-time/PGID/SID has no
remaining member before any post-restore health or identity check can run. Do
not raise this deadline to disguise a stalled or algorithmically unbounded
product restore; inspect the preserved failure evidence instead. A malformed,
linked, or incorrectly permissioned control file is deliberately nonterminal
and retains the remote lease for operator investigation.

For final 3.9.2 certification, set every workflow to `required`, set the target's
exact `OSCAR_BACKUP_MODE`, and set an exact `OSCAR_BUILD_LABEL`. The default
`disabled` mode is a complete valid release configuration and needs no restore
evidence. For optional `single` mode, first preserve the complete PASS directory
from an unfiltered `restore-drill` and point
`OSCAR_3_9_2_RESTORE_EVIDENCE_DIR` at it. Then run the unfiltered release profile:

```bash
npm run test:3.9.2-release
```

This mode rejects scenario filters, missing/skipped gates, a live backup mode
different from the configured expectation, and mismatched build or target
identity. Single mode additionally rejects restore evidence without the complete
authenticated-backup, canary, immutable-image, and pre-restore-safety-copy
attestation. For single-mode certification, the drill and release commands also
require the same available, committed, clean 40-hex suite HEAD. Tracked and
untracked changes are refused; Git-ignored `.env` and `results/` remain allowed.

Run one or more named scenarios with a comma-separated filter:

```bash
npm run test:full -- --scenario rpm-faults,adjudication
npm run test:smoke -- --scenario dashboard-health
```

The reserved lane is still isolated and restored when a full-profile scenario
filter is used.

## Configuration

Start from [.env.example](.env.example). Required values are:

| Variable | Meaning |
| --- | --- |
| `OSCAR_BASE_URL` | HTTPS origin for the test Viewer |
| `OSCAR_USERNAME` / `OSCAR_PASSWORD` | test account; never commit these |
| `OSCAR_TEST_TARGET_ACK` | exact hostname from `OSCAR_BASE_URL` |
| `RPM_EMULATOR_URL` | emulator HTTP origin |
| `TEST_RPM_ID` / `TEST_LANE_LABEL` | reserved emulator RPM and Viewer lane |
| `OPERATIONAL_VIEW_WORKFLOW` | `required` (default) for the seven-view release gate, `auto` for explicit legacy detection, or `disabled` |
| `OSCAR_LANE_CONFIG_PATH` | current-schema lane CSV used both to provision the test site and as the membership oracle |
| `EVENT_UUID_WORKFLOW` | `auto` for backward-compatible detection, `required` for a release gate, or `disabled` |
| `ALARM_TRANSFER_CAMERA_WORKFLOW` | `auto` for backward-compatible camera-control detection, `required` for a release gate, or `disabled` |
| `STORAGE_WORKFLOW` | `required` (default), explicit legacy `auto`, or `disabled` for the OSCAR 3.9.2 storage profile |
| `OSCAR_BACKUP_MODE` | exact product policy to certify: `disabled` (default) or optional `single` |
| `STORAGE_BACKUP_WORKFLOW` | `required` validates the selected mode, `auto` follows configured coverage, and `disabled` skips its mode-specific gate |
| `OSCAR_RELEASE_DIR` | absolute release path on the disposable OSCAR SSH target |
| `OSCAR_STORAGE_TARGET_ACK` | exact `<viewer-host>|<ssh-target>|<canonical-release-dir>|DISPOSABLE-STORAGE` interlock for every storage probe, including smoke |
| `OSCAR_BUILD_LABEL` | exact artifact/component identity; mandatory for `3.9.2-release` |
| `OSCAR_3_9_2_RESTORE_EVIDENCE_DIR` | complete PASS directory from the matching unfiltered restore drill; mandatory only for single-mode `3.9.2-release` certification |
| `EXTENDED_OCCUPANCY_SECONDS` | deterministic emulator occupancy duration; default/minimum 150 seconds reserves OSCAR's 60-second reconnect allowance and a 30-second Health/Dashboard observation window beyond the strict one-minute threshold |

Before any storage command or probe upload, the runner resolves
`OSCAR_RELEASE_DIR` on the SSH target and requires it to be an existing,
non-root directory whose remotely canonical path exactly matches both the
configuration and acknowledgement. Symlinked/non-canonical release paths and a
missing, linked, or non-regular `oscar.sh` are refused. The acknowledgement is
rechecked before every subsequent probe action.

Set `EVENT_UUID_WORKFLOW=required` when validating a Viewer build that claims
the occupancy UUID workflow. “Event UUID” is the operator-facing label for
OSCAR's durable public OSH observation ID. It is an opaque, normalized 1–128
character identity and is not required to have RFC 4122 punctuation. The suite
preserves and compares it exactly across Event Details, direct API lookup,
links, PDF/QR export, alarm video metadata, and retained-media manifests. The
default `auto` mode records one skipped check
instead of failing when the controls are absent from an older deployment. When
operational views are enabled, the same scenario searches the known identity from
one fixture-assigned view, requires the canonical Event Details URL to retain
that view, and proves a populated non-member view cannot resolve the occupancy.

Set `ALARM_TRANSFER_CAMERA_WORKFLOW=required` when the Alarm Transfer camera
scanner is part of the release contract. The scenario feeds Chromium a
deterministic 640x480 media stream containing a module-aligned, dense QR version
23 symbol for a 1,170-character valid OSCAR alarm transport. It gates camera
startup, a visible non-zero preview, a non-zero scan overlay contained by that
preview, a visible `Scanning` status, the deterministic active-camera identity
at 640 × 480, integrity and UUID import, complete media-track cleanup, and
visible denied-permission feedback followed by a successful retry. `auto` skips only
when the camera controls are absent; `disabled` always skips this workflow. This
is browser-level scanner coverage, not a physical camera or native
operating-system permission-dialog test.

Keep `EXTENDED_OCCUPANCY_SECONDS` at 150 or longer. Replacing the reserved RPM
configuration restarts its TCP server, and the emulator can begin the forced
occupancy before OSCAR detects the closed prior socket and reconnects. OSCAR and
the Viewer correctly time extended occupancy from the first start sample they
actually observe, not from the runner's configuration request. The 150-second
minimum covers the full 60-second reconnect allowance, the Viewer's strict
`duration > 60 seconds` default, and 30 seconds for the Status of Health and
Dashboard assertions to see the active state. A 70-second occupancy has only a
ten-second theoretical margin and is therefore not a valid release oracle.

The canonical future-build fixture is
[`fixtures/oscar-50-lane-config.csv`](fixtures/oscar-50-lane-config.csv). It uses
the current 20-column schema and assigns ten lanes apiece to `east-gate`,
`west-gate`, `north-gate`, `south-gate`, and `pedestrian`. The first five lanes
in each block also belong to `entrance`; the last five belong to `exit`. Apply
this file when provisioning the 50-lane regression site and keep
`OSCAR_LANE_CONFIG_PATH` pointed at that same file. Set
`OPERATIONAL_VIEW_WORKFLOW=required` for 3.9.1-and-newer release gates. Required
mode treats any mismatch in all seven exact lane sets—or failure to preserve the
view query through the real Status of Health navigation link—as a release failure.
The explicit `auto` mode remains compatible with older Viewers by recording a
skip only when the workflow itself is absent.

`OSCAR_SSH_TARGET` enables Docker/host performance sampling and the host-wide
suite lease. It is required by every mutating invocation, including the default
smoke run, reports/national-statistics filters, and both OSCAR 3.9.2 storage gates.
`OSCAR_SSH_IDENTITY_FILE` may point to a dedicated least-privilege key.
`BROWSER_EXECUTABLE_PATH` can select a preinstalled Chrome binary on a runner.

Storage-health is non-destructive but not strictly read-only: its publisher
contract creates and removes private temporary probe data, so the suite-wide
remote lease is held. The full `storage-lifecycle` scenario uses a separately acknowledged disposable
3.9.2 database and read-only observation probes to follow a naturally ingested,
eligible immutable child through verified whole-relation retirement. It never
inserts, updates, deletes, accelerates, or purges raw detector rows. It
also requires the documented zero-day, one-minute-query alarm-media profile on
that disposable test deployment. The packaged production profile uses immediate
asynchronous five-JPEG eligibility with a bounded five-minute query cadence and
preserves the original MP4 until at least 24 hours after verified publication.
Its observation archive is explicitly `PARQUET_PRIMARY`: exactly five immutable
detector outputs land in LOGGED 30-minute children, then use a five-minute
archive delay, one-minute worker, five-minute future-skew budget, and at most
eight partition retirements per cycle. The 30+5+1+5 = 41 minute nominal budget
has a one-hour operational SLO; failure or backlog preserves the child rather
than making that SLO a data-loss deadline. Checksum/UUID-count parity and exact
sidecar ownership across one or more capped generations precedes whole-child
detach/drop, leaving Parquet plus direct
daily files as the durable raw authorities. Mutable occupancy/alarm/adjudication
and compact metadata remain PostgreSQL-backed. `hotRetentionDays`,
`intervalMinutes`, and `rollbackGraceDays` retain their unchanged meaning only
for `HOT_RETENTION`. The fresh-schema gate verifies the broad generic payload
GIN and legacy archive-generation index are absent while required mutable-event
indexes remain. The suite reports stage age, attached/detached children,
ownership integrity, NULL legacy markers, mutable-only parent behavior, direct
cold-ID retrieval, and mixed hot/cold range filters. It does not restore a backup. Daily-file publication verification requires an
overnight/rotation-soak fixture. `STORAGE_BACKUP_WORKFLOW=required` validates the
selected product mode: disabled proves fail-closed non-mutation, while single
proves one authenticated self-contained snapshot. See
[docs/STORAGE_REGRESSION.md](docs/STORAGE_REGRESSION.md).

The automated storage probe is a Linux SSH/Docker gate. Native Windows Docker
Desktop/PowerShell acceptance is currently deferred and must be recorded as a
separate run; Linux execution and static PowerShell review do not constitute a
Windows pass.

`restore-drill` is a separate destructive profile and cannot be selected by a
smoke/full scenario filter. In addition to the ordinary target and storage
acknowledgements, it requires exact `OSCAR_RESTORE_TARGET_ACK`,
`OSCAR_RESTORE_DISPOSABLE_ACK`, `OSCAR_RESTORE_DATA_LOSS_ACK`, and
`OSCAR_RESTORE_PATHS_ACK` values. The last binds two supplied canonical,
non-overlapping archive and backup directories to the authorization. The drill
requires `OSCAR_BACKUP_MODE=single`. It
creates an authenticated 3.9.2 backup, mutates isolated canaries across the
database, application state, and archive, invokes the supported restore command,
and requires every canary plus a fresh promoted PostgreSQL timeline, a schema-v2
authenticated CURRENT recovery point, streamed in-snapshot WAL with no cumulative
`wal-archive.tar.gz`, a durable post-promotion write after restart, cleared one-time recovery state,
all service health, archive verification, and immutable image identities to return. The test backup
and `pre-restore-<backup-id>` safety directory are preserved for operator review.
All raw pre/restore/post resource samples remain in the report. Only the exact
`storage-restore-drill-disruption` phase is exempt from steady-state
running/health/identity checks, and only for `restore-drill`; a real host sample,
pre/post healthy coverage, stable restart counts, and zero OOM kills remain required.

## Results

Each run creates `results/<UTC timestamp>-<runner>/` containing:

- `functional-results.csv` — one row per expected behavior, including correct,
  incorrect, and skipped counts
- `performance.csv` — time-series resource samples by phase and target
- `storage-performance.csv` — PostgreSQL/WAL/batch, archive, journal, retained
  media and compact-metadata/index, and backup point-in-time counters
- `summary.csv` — correctness and resource aggregates
- `errors.csv` — browser, network, API, cleanup, and sampling errors
- `summary.md` — concise narrative PASS/FAIL report
- `run.json` — stable run metadata
- `evidence/` — screenshots and the reserved-RPM recovery snapshot
- `downloads/` — generated PDFs and exported offline alarm JSON/QR image files

The process exits `0` only when every evaluated check is correct. See
[docs/REPORT_SCHEMA.md](docs/REPORT_SCHEMA.md) for column definitions and CPU
interpretation.

## Runner deployment

Deployment to a dedicated Linux runner, strict SSH host-key setup, secret-file
handling, and repeatable commands are documented in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Reusable Codex skill

The installable skill is versioned at
[`skill/oscar-full-regression`](skill/oscar-full-regression). It guides future
agents through target authorization, runner deployment, smoke/full sequencing,
recovery, regression looping, and report interpretation. The same skill may be
installed in a user's Codex skills directory under the name
`oscar-full-regression`.

## Development

```bash
npm run check
npm test
npm run build
```

CI performs TypeScript validation and unit tests. Live OSCAR regression is kept
off shared GitHub-hosted runners because it requires private test infrastructure
and authorized state changes.

## License

ISC; see [LICENSE](LICENSE).
