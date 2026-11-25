# AI Agent & Contributor Guide — `ORNL/oscar-regression`

`ORNL/oscar-regression` is the official end-to-end Playwright, ConSys REST/MQTT, emulator fault/alarm injection, storage-lifecycle, OCR, Cargo UFF, and Training Sandbox certification suite for [`ORNL/oscar`](https://github.com/ORNL/oscar).

Read [`ORNL/oscar/AGENTS.md`](https://github.com/ORNL/oscar/blob/main/AGENTS.md) and [`ORNL/oscar/docs/ARCHITECTURAL_ROADMAP.md`](https://github.com/ORNL/oscar/blob/main/docs/ARCHITECTURAL_ROADMAP.md) before modifying scenarios or coverage oracles.

## Key Rules for Contributors & AI Agents
1. **Emulator-Backed Test Targets Only:** Never point mutating profiles (`full`, `extended`) at physical production RPM lanes.
2. **Idempotent Teardown & State Restoration:** Every mutating scenario must restore its reserved test lane (`testLaneLabel`), pre-existing Cargo UFF configuration, and `ui-endurance` runner services inside `finally` blocks so the target portal returns to clean 100%-online baseline health.
3. **Strict Sanitization:** Never commit real site credentials, `.env` files, private RFC1918 lab IP addresses, or internal `.local` hostnames in source or test fixtures (use `portal.example.test` or RFC 5737 `198.51.100.0/24` / `203.0.113.0/24` documentation ranges in unit tests).
4. **Planned `v3.12.0` Scenario Coverage:**
   - Track [`ORNL/oscar#80`](https://github.com/ORNL/oscar/issues/80) (`MobileDetectorSystem`) and [`ORNL/oscar#81`](https://github.com/ORNL/oscar/issues/81) (`Opt-In Custom Dashboards` at `/dashboards`) on shared `feat/v3.12.0-*` branches without altering existing canonical-route (`/`..`/users`) checks.

## Local Verification
```bash
npm test
npm run typecheck
```
