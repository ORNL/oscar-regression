# Coverage matrix

The suite combines browser-visible assertions with independent API/emulator
oracles. A rendered control alone is not considered proof of a working workflow.

| Area | Assertion | Profile | Mutation |
| --- | --- | --- | --- |
| Authentication | login/session identity and protected Viewer access | smoke | session only |
| Gateway caching | authenticated hashed Viewer bundles return private one-year immutable caching while `/sw.js` requires revalidation; a clean unauthenticated request for the same protected bundle returns 401/403 without public, immutable, or positive-age cache directives | smoke | none |
| Navigation & i18n | dashboard, events, health, reports, transfer, map, national, servers; 4-locale (`en`, `es`, `fr`, `el`) login + Viewer headings and zero horizontal overflow at `1280x800` and `1920x1080` | smoke | none |
| Map | interactive map has a non-zero rendered area | smoke | none |
| National | capture the exact baseline observation when one exists (a fresh zero-observation site is valid); require Refresh to remain disabled with `aria-busy=true` while its command is pending and return to enabled/idle only afterward; follow that command's durable status to `COMPLETED` (or legacy `ACCEPTED` only with a result); reject failed/rejected/canceled commands; require a new exact `observation@id` relative to any baseline; require the Viewer's exact GET to succeed; fetch that observation and compare all rendered local-node counts to it | smoke | statistics command/bucket data |
| Servers | local node list and add-server form render | smoke | none |
| Admin | SensorHub Admin loads and exposes configured sensor/module content | smoke | none |
| Health inventory | expected lane and camera counts; all fault fields present | smoke | none |
| Connections | reserved RPM and every configured camera resolve Online | smoke | none |
| Dashboard health | expected lane/RPM/per-camera indicator inventory; every emulator RPM explicitly reports `tamper_fault=false` while connected; every lane resolves with no Tamper Unknown/Active indicator; every exact expected connection-chip identity resolves to an accessible live Online state within 45 seconds; one selected camera Offline while every other component stays Online; deterministic all-Offline and completed Unknown reconciliation; all five exact Unknown fault labels; live recovery; keyboard lane navigation; health batches of at most 10 streams with at most two requests in flight | smoke | read-only emulator state plus browser response fixtures |
| Lane detail | charts and event table render; after real Dashboard navigation, live Gamma and Neutron datasets each paint their chart-specific plot color outside the legend region | smoke | HLS start/stop commands |
| Video | decoded dimensions, ready state, advancing playback time, and concurrent multi-viewer `X-OSCAR-HLS-Viewer` lease sharing (`heartbeat` 204 + single-viewer `closing` 204 without interrupting active peers) | smoke | HLS start/stop commands |
| Events | rows load; Advanced Filter returns only the requested lane; CQL array-membership filters (`adjudicatedIds='eml-non-threat'` and `!=`) execute cleanly across PostgreSQL/DuckDB; an authenticated, bounded count-and-page oracle derives an exclusive cutoff from a known nonempty occupancy page and requires a positive count plus only earlier `startTime` values; after generated alarms exist, the same oracle retains the Dashboard's unadjudicated gamma/neutron predicate | both | none beyond the full profile's already-generated alarm data |
| Operational views | fixture-derived exact Dashboard card/RPM/camera membership and Status of Health lane sets for east/west/north/south/pedestrian/entrance/exit; Dashboard-to-Health query persistence; invalid, unassigned, and duplicate parameters fail closed | smoke | none |
| Reports | site, one-lane lane, alarm, alarm/occupancy, and health PDFs | smoke | report bucket writes |
| Alarm import | malformed payload is rejected visibly | smoke | none |
| Alarm camera import | deterministic Chromium 640x480 stream starts; preview and contained scan overlay are visible and non-zero; visible status says `Scanning`; active camera reports the deterministic identity and 640 × 480; dense QR v23/1,170-character transport decodes with valid integrity and UUID; all tracks stop; denied permission is reported and retry succeeds | both | local generated media only |
| RPM connection | stop/restart appears Offline/Online on Status of Health and the Dashboard while camera state remains independently Online; the Status-of-Health oracle matches the RPM's own labeled state and cannot pass early on a camera's Online text; the reconnected RPM must also publish and display an explicit `Tamper: Clear` baseline | full | reserved RPM only |
| Faults | gamma high/low, neutron high, and tamper assert and clear on Status of Health and the Dashboard; Dashboard tamper clear stays in place, posts the real SensorHub control command, and clears the observed state | full | reserved RPM only |
| Alarms | back-to-back one-second gamma and neutron occupancies make the second camera OPEN queue behind the first generation's keyframe-gated OPEN/CLOSE; the exact OSCAR log window has zero camera timeout/quarantine/rejection/result-timeout/stale-generation/command-failure symptoms; both alarms reach Event Log and each row resolves its exact public occupancy observation ID; authenticated `result.videoPaths` contains one nonblank unique `videos/clips/<camera-token>/<timestamp>-g<generation>.mp4` per OSH-configured lane camera; cross-event uniqueness, directory ownership, nonzero source objects, and Chromium MP4 metadata are verified | full | permanent event data and source clips |
| Event identity | capture the persisted public occupancy observation ID shown as “Event UUID”; accept its opaque normalized 1–128-character product form without imposing RFC 4122 punctuation; verify details, UUID search, canonical direct link, clipboard actions, fresh-page resolution, explicit not-found state, assigned-view query preservation, non-member-view fail-closed behavior, print-to-PDF text, and QR v1 round-trip with exact identity equality | full | one permanent alarm event; local clipboard/artifacts |
| Alarm transfer | selected alarm JSON round-trip and SHA-256 integrity; each imported non-empty series redraws with its chart-specific dataset color; the received package downloads with the same canonical payload, integrity, transport, and UUID while export-only QR metadata may be omitted; the actual exported QR PNG uploads and imports successfully | full | local artifacts only |
| Adjudication | Code 9 submission, confirmation, success, audit display | full | permanent audit record |
| EML auto-adjudication | external LLNL EML plugin upload/activation in `Services -> OSCAR Service -> EML Plugin Path`, zero HTTP bucket exposure, distributed NORM gamma alarm auto-adjudicated as Code `9999` (`EML Non-Threat`) with `EML_METADATA` JSON, suppressed from Dashboard unadjudicated queue, queryable in Event Log (`Adjudicated = EML Non-Threat`), and localized threat `INVESTIGATE` alarm kept unadjudicated on Dashboard | full | permanent event/audit records + private `/var/lib/oscar/eml-plugin` state |
| Extended occupancy | a deterministic quiet occupancy lasts at least 150 seconds so OSCAR has its complete 60-second reconnect allowance and both Status of Health and Dashboard retain a 30-second observation window after the Viewer's strict one-minute threshold; both surfaces fault, then clear | full | reserved RPM only |
| Adjudication report | one-lane PDF is generated and validated | full | report bucket write |
| Performance | runner plus optional host/container time series and aggregates | both | read-only SSH |
| Storage platform | exact 3.9.2 app/PostGIS tags and OCI labels, pinned gateway tag, running/local immutable image IDs and available digests, exact checksum marker plus archive and conditional single-mode backup root identities, structural persisted JSON extraction, explicit fresh-schema `PARQUET_PRIMARY` mode, 30-minute LOGGED stage + five-minute delay + one-minute worker + five-minute skew budget (41-minute nominal, one-hour SLO), at most eight whole-partition retirements/cycle, exact five immutable-output allowlist, attached/detached child and oldest-`received_at` reporting, exact compact sidecar ownership with no orphan/missing owners, NULL legacy markers, mutable-only parent behavior, absence of the generic payload GIN and archive-generation index plus presence/shape of required mutable-event indexes, effective observation batching, stable private deployment lock, packaged/running archive and restore-preparation helper parity, compiled atomic publisher behavior, no full-backup-root mount in either long-running service plus isolated one-shot base-backup wiring, PostgreSQL archive mode off/timeout zero/inactive command and no external WAL bind, no archive partial artifacts, data checksums, exact schema v5/checksum, bounded DuckDB resources/scratch, exact direct-daily-file config, archive checksum/catalog/parity health, cold public-ID lookup, mixed hot/cold filters, and storage counters; legacy `HOT_RETENTION` controls remain mode-specific | smoke | SSH plus private temporary atomic-publisher behavior test under the suite lease |
| Retained media | exact five quality-85 canonical, hash-valid bounded baseline JPEGs per camera; every manifest binds the event's authoritative `urn:osh:system:lane:*` UID rather than its RPM child; every frame independently decodes in Chromium at its declared dimensions; strict streaming catalog/frame and event resource budgets; schema-2 reclamation checkpoint; exact `{epoch-hour}-{00..11}.idx` processed and sharded deletion-index headers/36-byte records; no legacy marker/tombstone inode growth; lazy selected-frame Viewer loading with a measured three-request concurrency ceiling and decoded content replacement; legacy-video fallback on retained API 404; in full, every generated exact public observation ID has one source-bound manifest per camera, five valid JPEGs, a final one-attempt/no-failure ledger, and no run-new orphan MP4 or partial in its authoritative camera directories | both | smoke/non-lifecycle requires a configured retained event; an unfiltered full run self-seeds exact event IDs and creates retained sets on a disposable zero-day profile |
| Daily files | exact persisted journal/lifecycle config; exact three-field schema-1 configured-zone metadata with durable lifecycle-index version 1; bounded link-safe publication tree; when a prior configured-zone day exists, exact 12-key v1 CSV manifests with current hash/byte/record agreement; before the first boundary, an explicit correct not-yet-eligible result backed by nonempty current-day `.open`/`.seg` files with safe layout and exact `DJNL` v1 headers; emulator-triggered direct append to the canonical lane-UID journal; bounded per-segment hash/size inventory; the supported whole-deployment restart runs in an explicitly exempt metrics phase, must preserve every sealed segment byte-for-byte and every open segment as itself or one sealed successor with its entire pre-restart prefix, leave no partials, terminate the scoped retention query, and emit no database/module shutdown or camera recording timeout/quarantine/stale-generation errors | both | reserved RPM transition and OSCAR restart in full |
| Tiered archive | deterministic exact-five-output primary profile; read-only selection of one naturally ingested newly completed 30-minute child; exact initial row/owner/marker inventory; bounded read-only witness lock proving every child row has one compact owner across the exact set of parity-verified active/sealed generations; registry and physical whole-child retirement; exact post-drop generation-ID set, aggregate row parity, sealing, and selected-ID queryability with no observation-row DELETE; deployed helper verify/copy/rejection checks; portable export; exact cold public-ID and mixed attached-hot/Parquet-cold filters; every DuckDB operation removes its canonical scratch directory while preserving only the exact safe permanent lease | full | needs sustained emulator traffic and a newly completed child; mutable event/workflow outputs are not Parquet-primary |
| Atomic publication | packaged and deployed atomic-publisher source/binary identity; flushed-tree publication contract; first publish, destination-collision rejection, and source/destination preservation | both | private disposable directories under the OSCAR state volume |
| Legacy HOT_RETENTION controls | isolated synthetic allocator/race, `GENERATION_EXACT`, `COLD_RANGE_CONSERVATIVE`, and `HOT_EXACT` hold/purge helpers remain contract-tested for a separately controlled HOT_RETENTION acceptance run; `PARQUET_PRIMARY` never calls them | separate compatibility acceptance | disposable legacy-profile store only; not part of primary raw retirement |
| Backup policy | default disabled mode: archive mode off/timeout zero/inactive command, no external WAL bind or host-WAL growth, and all backup-family commands reject before mutation; optional single mode: one HMAC-authenticated CURRENT schema-v2 snapshot, streamed `pg_wal`, no cumulative WAL tar, successful `pg_verifybackup`, no staging/non-current v2 snapshot, retired prune command, atomic recovery contract; both retain five-JPEG and Parquet lifecycle gates | full | disabled refusal or one single snapshot; restore is separate |
| Restore drill | exact-release and single-mode preflight; independently reauthenticated schema-v2 CURRENT backup with streamed in-snapshot WAL and no external WAL dependency; pre-backup and post-mutation canaries across database, application state, and an empty canonical app-owned archive partition/profile hierarchy; authenticated deployment configuration/credential payload; private root-owned no-link pre-restore `.env`/secrets/TLS safety copy; promotion to a fresh PostgreSQL timeline; durable post-promotion write after checkpoint/restart; exact VERIFIED epoch reconstruction; recovery-setting cleanup; service/archive/image postchecks | restore-drill only | overwrites the isolated deployment from a new self-contained backup |
| 3.9.2 / 3.11.0 certification | unfiltered full suite with operational views, UUID lookup/export, Alarm Transfer camera, storage, five-JPEG, Parquet lifecycle, configured backup-mode gate, and (in `3.11.0-release`) external EML runtime upload + auto-adjudication all required; disabled mode is certified live without restore evidence, while single mode also requires matching unfiltered restore-drill PASS evidence and a schema-v2 attestation | 3.9.2-release / 3.11.0-release | same mutations as full; single-mode restore is prior evidence, not rerun inline |

## Deliberate exclusions

The following are not automatic gating checks because they are destructive,
external, or depend on nondeterministic operating-system UI:

- applying/saving SensorHub Admin configuration, restarting arbitrary modules,
  or removing lanes
- “select all filtered” bulk adjudication outside an isolated synthetic fixture;
  it can permanently adjudicate unseen historical pages
- external WebID services
- physical camera hardware, lighting/focus behavior, and the native
  operating-system camera permission prompt; the suite instead gates the web
  scanner with a deterministic generated Chromium media stream and exercises
  denied-permission feedback inside the browser fixture
- live camera disconnect/reconnect fault injection; all configured cameras must
  be Online against live data, while browser-only fixtures deterministically
  exercise every camera's Offline and Unknown Dashboard presentation
- native Share and print dialogs; the suite validates copied link text and uses
  Chromium print-to-PDF against the same print media rather than automating an
  operating-system dialog
- applying operational-view metadata inside a run; the tracked 50-lane CSV must
  be applied while provisioning the disposable site, then the suite reads that
  same file as its membership oracle
- destructive backup restore in smoke/full (the separately path-bound,
  four-acknowledgement `restore-drill` profile covers only an isolated
  disposable target), production retention changes, broad archive purge, and
  physical/production data
- native Windows Docker Desktop/PowerShell storage and restore acceptance; it
  remains deferred and must not be inferred from the Linux SSH/Docker run or
  static PowerShell inspection
- a live archive-disabled configuration restart solely to repeat HOT_EXACT
  deletion enforcement; the disposable lifecycle proves it with archiving
  enabled, while the disabled-profile variant remains a product-integration or
  separately provisioned E2E check
- forced 30-second saturation of the two-session DuckDB admission gate; the
  suite asserts the exact persisted limit/timeout and post-operation scratch
  cleanup, while contention timing remains a product integration test

These require a disposable deployment and a separate, explicit test plan.

## Scenario names

`preflight`, `viewer-navigation`, `map-national-servers`, `sensorhub-admin`,
`status-of-health`, `dashboard-health`, `lane-video`, `event-filtering`, `operational-views`,
`reporting`, `alarm-transfer`, `alarm-transfer-camera`, `rpm-connection`,
`rpm-faults`, `rpm-alarms`, `event-uuid`, `adjudication`, `eml-auto-adjudication`, `extended-occupancy`,
`adjudication-report`, `storage-health`, `storage-lifecycle`, and the isolated
`storage-restore-drill` scenario selected only by `--profile restore-drill`.

`dashboard-health` is a read-only scenario. Before accepting the UI baseline it
queries every emulator RPM and requires a distinct, running, OSCAR-connected
inventory whose modeled `tamper_fault` is explicitly `false`. It then requires
every Dashboard lane to resolve with no Tamper Unknown or Active indicator after
the live latest-observation batches settle. An Online icon alone is not the
harness's Tamper oracle, and the harness does not assert then clear Tamper to seed
telemetry. The product contract is that OSCAR's Rapiscan driver publishes an
initial clear observation whenever an RPM connection is established, before it
processes subsequent `TT`/`TC` messages. The scenario then intercepts only the
Dashboard's batched latest-observation responses to prove accessible Offline and
Unknown rendering without changing SensorHub or emulator state. The full profile
separately stops/restarts the reserved RPM and injects each supported fault to
verify real Dashboard transitions and recovery.

`lane-video` starts on the Dashboard and uses the real lane link. In addition to
the component and HLS checks, it waits for red Gamma and blue Neutron pixels in
the central Chart.js plot regions. Legend pixels are excluded, so an empty chart
container or threshold-only Gamma chart cannot pass.

`event-filtering` captures the Event Log's actual authenticated occupancy query,
derives a cutoff one millisecond after a returned event, and independently calls
both the count and bounded page endpoints with `startTime < cutoff`. It requires
HTTP success, a positive count, and every returned start time to precede the
exclusive cutoff. The full `rpm-alarms` scenario repeats this after its generated
alarms exist while preserving the Dashboard predicate for gamma/neutron alarms
whose adjudication count is zero. Credentials remain inside the Playwright
authenticated context and are never placed in URLs, reports, or command lines.

`event-uuid` is capability-gated with `EVENT_UUID_WORKFLOW`. Its default `auto`
mode skips cleanly on older Viewer builds; use `required` for builds that claim
the feature. The Viewer label does not imply an RFC 4122 wire format: the suite
accepts the same normalized 1–128-character opaque public observation identity
as Viewer and requires exact equality at every boundary. With operational views
enabled, the fixture selects one assigned
view and one populated non-member view for the reserved lane. Search must retain
exactly one assigned `view` parameter through canonical Event Details
navigation, while the same UUID must display the not-found state in the
non-member scope without leaking event data. The general not-found check uses a
newly generated identity and never deletes an event.

`alarm-transfer-camera` is capability-gated with
`ALARM_TRANSFER_CAMERA_WORKFLOW`. Its default `auto` mode skips cleanly on older
Viewers without camera controls; use `required` for builds that claim the
scanner. The fixture is a 640x480 Chromium media stream containing a
module-aligned QR version 23 symbol (109 modules plus a four-module quiet zone,
rendered at three pixels per module) for a 1,170-character OSCAR alarm transport.
The density intentionally detects scanners that crop to the former centered
320-pixel region and requires the repaired scanner's roughly 420-pixel native
square. The scenario verifies a visible non-zero preview, a non-zero scanner
overlay fully contained within that preview, a visible `Scanning` status, the
deterministic active-camera identity at 640 × 480, successful integrity and
UUID import, stopped tracks, and denied-permission feedback with a successful retry.
The full-profile alarm transfer also uploads the actual QR PNG exported by the
Viewer rather than reconstructing an equivalent image.

`operational-views` is capability-gated with `OPERATIONAL_VIEW_WORKFLOW`. In
`required` mode, all seven keys from `OSCAR_LANE_CONFIG_PATH` are mandatory and
must expose exactly the fixture lanes. `auto` skips cleanly only on legacy
Viewers without the operational-view workflow; once detected, membership and
fail-closed checks remain gating.

`reserved-lane-setup` and `reserved-lane-cleanup` are mandatory harness phases
for every full-profile run and cannot be suppressed by a scenario filter.
