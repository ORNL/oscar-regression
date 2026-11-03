# Continuous UI Endurance & Adjudication Harness

`src/ui-endurance.ts` (`npm run test:ui-endurance` / `./scripts/run-ui-endurance.sh`) continuously validates live OSCAR Viewer alarm population, Operational View isolation, Progressive Web App (PWA) Service Worker notifications, and the full Adjudication UI over arbitrarily long multi-hour or multi-day endurance runs.

## Architecture

The runner launches headless Chromium with TLS SubjectPublicKeyInfo (`--ignore-certificate-errors-spki-list`) pinning derived from the target HTTPS endpoint so `/sw.js` activates cleanly on self-signed test certificates without mutating host trust stores.

Two isolated browser contexts run concurrently:

1. **Wallboard Watcher Context (`wallboardContext`)** — simulates 24/7 command-center displays:
   - **Tab 1 — Unscoped Dashboard (`/`)**: Never reloads across the entire run (`window.__oscarUnscopedMountId` verified every cycle). Validates all configured `LaneStatus` cards, `/manifest.json`, `/sw.js` activation, live MQTT `EventTable` Page-0 population (`assessPageZeroAlarmVisibility`), live `alarm-notification-*` emission, and Chrome DevTools Protocol memory/DOM/listener metrics (`JSHeapUsedSize`, `Nodes`, `JSEventListeners`).
   - **Tab 2 — Scoped Operational View (`/?view=<viewKey>`)**: Holds long-lived WebSocket subscriptions across multi-cycle view epochs rotating through all 7 canonical operational views (`east-gate`, `west-gate`, `north-gate`, `south-gate`, `pedestrian`, `entrance`, `exit`). Enforces fail-closed scope isolation (`assessScopedViewIsolation`) across `LaneStatus` cards, `EventTable` rows, and Service Worker notification payloads (`data.viewKey`).

2. **Operator Workstation Context (`operatorContext`)** — continuously exercises every adjudication surface across both unscoped and scoped views while strictly excluding `TEST_LANE_LABEL` (`Lane50`) and yielding automatically whenever `/run/lock/oscar-regression-suite/suite.lock` is held by a regression run:
   - **`pwa-notification-detail`**: Inspects live Service Worker `alarm-notification-*` notifications, verifies `dismiss` handling, triggers real `sw.js` `NotificationEvent('notificationclick', { action: 'view-alarm' })` routing into `/event-details?eventId=<obsId>`, and exercises the complete `AdjudicationDetail` form:
     - Empty-code (`Code 0`) submission guard,
     - Multi-file upload, `WebID` toggle, `Detector Response Function`, `Spectrum Type` (`Foreground`), `Synthesize Background`, and file deletion,
     - `Spectroscopic QR Code Scanner` dialog with deterministic camera preview/scan, `Clear All` / `Delete scanned code`, and `MediaStreamTrack` release verification (`activeTrackCount === 0`),
     - Disposition group subheaders + `Code 9: Authorized Test, Maintenance, or Training Activity`,
     - `Isotope` single-select, multi-select, and `Unknown` exclusivity collapse,
     - Rotated `Secondary Inspection` (`NONE`, `REQUESTED`, `COMPLETED`), `Vehicle ID`, and `Notes`,
     - `Confirm Adjudication Submission` summary verification, `Cancel` preservation check, `Confirm & Submit`, ConSys REST persistence (`adjudicatedIdsCount >= 1`), and reloaded `Logged Adjudications` + bucket evidence verification.
   - **`scoped-quickview-inline`**: Opens inline `QuickView` (`EventPreview`) on scoped `/?view=<viewKey>`, verifies `Occupancy ID`, `Share occupancy`, and `Export alarm QR` controls, exercises `Reset` (clearing fields and re-disabling `Submit`), submits `Code 9`, and verifies live row removal from `alarmtable` without reloading.
   - **`event-log-filter-detail`**: Exercises `/event-log` and `/event-log?view=<viewKey>` with `NestedEventFilterDialog` (`Advanced filters`), adjudicates via `/event-details`, and verifies `Adjudicated = Yes` in `/event-log`.
   - **`bounded-bulk-adjudication`**: Selects strictly **2** non-reserved alarm rows (never `Select all filtered alarms`), tests `Clear selection`, submits `Bulk adjudication` (`2 succeeded; 0 failed.`), and verifies both rows disappear live from `alarmtable` and persist in ConSys.

## Usage

Bounded 4-cycle verification (runs all 4 adjudication workflows once):

```bash
./scripts/run-ui-endurance.sh --max-cycles 4
```

Continuous daemon mode (rotates across all workflows and all 7 operational views indefinitely until `SIGINT`/`SIGTERM`):

```bash
./scripts/run-ui-endurance.sh --continuous --interval-ms 20000 --scoped-hold-cycles 4
```

Read-only wallboard + PWA endurance mode (zero adjudications):

```bash
./scripts/run-ui-endurance.sh --continuous --read-only-wallboard
```

## Output Artifacts

Each run writes private (`0700`/`0600`) crash-safe artifacts under `results/ui-endurance/<run-id>/`:

- `summary.json` and `summary.md` — atomically updated after every cycle
- `wallboard-samples.csv` — per-cycle unscoped/scoped wallboard checks & CDP heap/DOM/listener telemetry
- `adjudications.csv` — per-cycle operator workflow results & ConSys verification
- `cycles.jsonl` — structured cycle log
- `errors.csv` and `evidence/*.png` — console/network diagnostics and failure screenshots
