# Linux runner deployment

The recommended runner is a dedicated Linux machine on the same test network as
OSCAR, the RPM emulator, and the camera emulator. The current validated runner is
`tyrone@192.168.0.60`; the OSCAR URL remains the remote deployment URL, not
`localhost` and not `oscar.local` unless that name resolves on the runner.

## Install

Clone the repository into a non-shared directory and install locked dependencies:

```bash
git clone https://github.com/ORNL/oscar-regression.git
cd oscar-regression
npm ci
```

Use either an installed Chrome:

```text
BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

or install Playwright Chromium:

```bash
npm run install:browser
```

Copy `.env.example` to `.env`, populate it outside Git, and set mode `0600`.
On an NVM-based noninteractive SSH session, put the desired Node binary on
`PATH`; `scripts/run-regression.sh` also locates the newest installed NVM Node.

For a later clean-directory upgrade, use
`scripts/rebind-active-release.sh --build-label LABEL` to preview the uniquely
running Compose release, then repeat it with `--apply`. The helper validates the
remote canonical non-symlink directory and exact running application container,
and atomically updates only `OSCAR_RELEASE_DIR`, `OSCAR_STORAGE_TARGET_ACK`, and
`OSCAR_BUILD_LABEL`. It refuses a runner armed with restore acknowledgements.
This is intentionally explicit: choosing the lexically newest directory would
not prove that it is active, and silently moving a destructive acknowledgement
would weaken the regression safety boundary.

Provision every canonical 50-lane regression build with
`fixtures/oscar-50-lane-config.csv`. Keep `OSCAR_LANE_CONFIG_PATH` pointed to the
same tracked file so the UI assertions are derived from the deployed source of
truth rather than duplicated expectations.

When provisioning through SensorHub Admin, a successful upload is only the
in-memory step. Select **Apply Changes**, select the header's global **Save**,
confirm **Yes** in the separate dialog, and require the **SensorHub Configuration
Saved** notification. Perform one supported OSCAR restart and require all 50
Lane, RPM, and camera modules to return before starting regression. Clicking
Save without confirming Yes must fail provisioning.

OSCAR's Rapiscan driver must publish an initial Tamper-clear observation every
time an RPM connection is established, before processing later device `TT`/`TC`
messages. Deploy or restart OSCAR normally so all 50 test RPM connections pass
through that initialization path. The suite independently verifies the
emulator's modeled boolean and the resulting Dashboard state; the harness will
not infer clear from an Online icon or toggle Tamper across the site.

The retained-media worker reads its profile at OSCAR startup. On a newly initialized
disposable 3.9.2 target, save the accelerated profile and perform a supported restart
before importing the lane fixture or permitting emulator traffic. Require
`retention-runtime-health` to report a valid schema-1 scan checkpoint no more than
180 seconds behind the zero-day eligible cutoff, then import and persist the lanes
and perform the fixture restart. A cursor created while the seven-day default was
active catches up monotonically and must not be mistaken for an active accelerated
profile. Never delete or fast-forward scan or reconciliation checkpoints. If setup
was performed in the wrong order, recreate the disposable database and application
state or allow oldest-first catch-up.

## Strict SSH for performance and storage validation

The 3.9.2 target-side storage helper is a Linux Bash/Docker probe. Native
Windows Docker Desktop plus PowerShell/`oscar.bat` acceptance is not executed by
this path and remains deferred. Do not translate a successful Linux run or
static PowerShell contract test into a Windows deployment pass; capture a
separate Windows-native transcript when that machine is available.

SSH is optional only for an explicitly filtered, genuinely non-mutating run.
The default smoke run posts commands/writes reports and the storage-health
atomic-publisher proof uses private temporary data, so it requires SSH for the
host-wide suite lease even when fault injection is absent. The OSCAR 3.9.2
storage gate also uses SSH for metrics and its target probe. Before setting
`OSCAR_SSH_TARGET`:

1. obtain the OSCAR host's SSH fingerprint through a trusted channel
2. scan the host key and compare the fingerprint exactly
3. add only the verified key to the runner's `known_hosts`
4. use a dedicated key whose account can read Docker stats but cannot administer
   unrelated hosts
5. verify noninteractive access with `BatchMode=yes` and
   `StrictHostKeyChecking=yes`

If SSH is not configured, non-storage functional tests and runner metrics can
still run only after selecting an explicit non-storage workflow; container/host
fields are absent. A required 3.9.2 storage gate fails closed instead of silently
omitting those checks.

For OSCAR 3.9.2 storage validation, use an isolated checkout or release directory
and a fresh disposable database. Pin the same SSH host key, configure
passwordless noninteractive sudo only for the authorized test account, set
`OSCAR_BUILD_LABEL` to the exact 3.9.2 artifact and component SHAs, and apply the
variables described in [STORAGE_REGRESSION.md](STORAGE_REGRESSION.md). The
probe independently gates the exact Compose tags, local/running immutable image
IDs, available repository digests, OCI labels, and storage marker. The canonical
50-lane operational-view fixture remains mandatory. Do not deploy or reconfigure
OSCAR as part of updating this suite checkout.

## Run

```bash
./scripts/run-regression.sh smoke
./scripts/run-regression.sh full
./scripts/run-regression.sh full --scenario rpm-faults,adjudication
# Release gate for a build that claims the occupancy UUID workflow:
EVENT_UUID_WORKFLOW=required ./scripts/run-regression.sh full --scenario event-uuid
# With operational views enabled, this also gates assigned-view URL persistence
# and non-member-view fail-closed lookup for the reserved lane.
# Release gate for deterministic Alarm Transfer camera scanning:
ALARM_TRANSFER_CAMERA_WORKFLOW=required \
  ./scripts/run-regression.sh smoke --scenario alarm-transfer-camera
# Release gate for the canonical seven operational views:
OPERATIONAL_VIEW_WORKFLOW=required OSCAR_LANE_CONFIG_PATH=fixtures/oscar-50-lane-config.csv \
  ./scripts/run-regression.sh smoke --scenario operational-views
# Read-only OSCAR 3.9.2 storage gate after the rotation/media fixture soak:
STORAGE_WORKFLOW=required ./scripts/run-regression.sh smoke --scenario storage-health
# Separately acknowledged disposable lifecycle (never production):
STORAGE_WORKFLOW=required ./scripts/run-regression.sh full --scenario storage-lifecycle
# Destructive isolated restore qualification. Set every documented storage and
# restore path/acknowledgement first; never place these values on a normal runner.
OSCAR_BACKUP_MODE=single STORAGE_WORKFLOW=required STORAGE_BACKUP_WORKFLOW=required \
  ./scripts/run-regression.sh restore-drill
# Final unfiltered candidate gate. Disabled (the default) needs no restore
# evidence; single mode requires OSCAR_3_9_2_RESTORE_EVIDENCE_DIR to identify
# the complete matching restore-drill PASS. Set all five workflows required.
./scripts/run-regression.sh 3.9.2-release
```

Review `summary.md`, `functional-results.csv`, `errors.csv`, and cleanup rows
before accepting a build. Preserve the whole run directory when filing a defect.

## Updating a deployed checkout

```bash
git fetch --prune origin
git pull --ff-only
npm ci
npm run check
npm test
```

Do not place `.env`, SSH private keys, or generated `results/` in Git. Every
mutating run holds the same host-wide remote lease; contention fails closed and
the live lease is released in `finally` or when the runner SSH stream closes.
This does not coordinate manual operators.

## Exit codes

- `0`: all evaluated functional checks correct
- `1`: one or more functional checks incorrect
- `2`: configuration/initialization failure
- `130`: interrupted run after cleanup was requested
