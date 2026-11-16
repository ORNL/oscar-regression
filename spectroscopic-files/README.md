# Local Secondary-Inspection Spectroscopic Files (`spectroscopic-files/`)

Place local secondary-inspection radiation identifier (RIID) `.spe` and `.n42` files in this directory so the continuous UI endurance runner (`npm run test:ui-endurance` / `./scripts/run-ui-endurance.sh`) and the `adjudication` regression scenario automatically exercise real secondary-inspection uploads, OSCAR `N42 Report` display, Sandia Full Spectrum **WebID** analysis, and operator isotope/disposition selection.

> **Repository Hygiene:** All spectroscopic data files and device subdirectories placed under `spectroscopic-files/` are ignored by `.gitignore` (`spectroscopic-files/*`, `!spectroscopic-files/README.md`, `*.spe`, `*.n42`, `*.n42.xml`, `*.spc`). **Never force-add (`git add -f`) operational, vendor, or test-campaign `.spe`/`.n42` spectra to Git.** Keeping spectra git-ignored also preserves the clean Git working tree required by strict release certification profiles (`3.9.2-release`, `3.11.0-release`, and `restore-drill`).

---

## 1. Where to Put Your Files

By default, both the auto-adjudication endurance runner and the `adjudication` scenario recursively scan:

```text
<oscar-regression-checkout>/spectroscopic-files/
```

You may place files directly inside `spectroscopic-files/` or organize them into any nested folder hierarchy (for example by test campaign, RIID model, or source type):

```text
spectroscopic-files/
├── README.md                              # Tracked documentation (keep in Git)
├── GR1/
│   └── GR-1~2025.10.16-10_52_45.spe       # IAEA .spe spectrum
├── IdentiFINDER-R225/
│   ├── spectrum_1872.n42                  # Medical isotope (e.g., I-131)
│   └── spectrum_747.n42                   # Multi-isotope / SNM spectrum
├── IdentiFINDER-R300/
│   ├── Identification_4706.n42            # Alarmed N42 with embedded nuclide ID
│   └── Spectrum_4674_nuisance.n42         # Unalarmed nuisance / background spectrum
├── RanidPro/
│   └── meas_SUM_ANSI-N42.42-2012.n42.xml  # ANSI N42.42-2012 (.n42.xml)
├── SNIPER-GN/
│   ├── ID-2025.10.16-gamma.spe            # Automatically paired with -neutron.spe
│   └── ID-2025.10.16-neutron.spe
└── Syclone/
    └── 50310N_2025_10_16_10_49_14.xml     # RadComm <RadSamplerData> XML
```

### Using an External Directory Instead

If your `.spe` / `.n42` corpus lives outside the repository checkout, point the suite at that folder without copying files:

- **Environment variable (`.env` or shell):**
  ```bash
  OSCAR_SPECTRA_DIR=/path/to/your/spectroscopic-corpus
  ```
- **UI Endurance CLI flag:**
  ```bash
  ./scripts/run-ui-endurance.sh --spectra-dir /path/to/your/spectroscopic-corpus --max-cycles 8
  ```

When `OSCAR_SPECTRA_DIR` (or `--spectra-dir`) is explicitly set, the runner validates that the directory exists and contains at least one supported spectroscopic file when `SPECTROSCOPIC_WORKFLOW=required`. When neither is set and `spectroscopic-files/` contains only `README.md`, the suite cleanly falls back to its built-in synthetic attachment checks so fresh clones run out of the box.

---

## 2. Supported File Formats & Companion Pairing

The catalog scanner (`src/spectroscopic-catalog.ts`) discovers the following extensions (case-insensitive):

| Extension | Description |
| --- | --- |
| `.n42`, `.n42.xml` | ANSI N42.42-2006 and N42.42-2012 XML spectra (single-record or multi-sample foreground + background, including `<CountedZeroes>` channel compression and embedded `<NuclideAnalysisResults>`). |
| `.spe` | Text IAEA `.spe` spectra (`$DATA:`, `$MEAS_TIM:`, `$ENER_FIT:` / `$MCA_CAL:`). OSCAR converts `.spe` spectra for `N42Output` visualization and WebID submission even when native `SpecUtils` libraries are unavailable. |
| `.xml` | Vendor spectroscopic XML documents whose header contains `<RadInstrumentData`, `<N42InstrumentData`, or `<RadSamplerData` (such as RadComm Syclone exports). Non-spectroscopic XML files are ignored automatically. |

### Automatic Companion Pairing

- **Gamma + Neutron `.spe` Pairs:** Files in the same folder sharing a stem with `-gamma.spe` / `_gamma.spe` and `-neutron.spe` / `_neutron.spe` suffixes (for example `ID-2025.10.16_10.51.36-0500-gamma.spe` and `...-neutron.spe`) are grouped into a single secondary-inspection sample and uploaded together.
- **Foreground + Background Pairs:** Files in the same folder sharing a stem with `fg` / `foreground` and `bg` / `bkg` / `background` tokens (for example `pass01_foreground.n42` and `pass01_background.n42`) are paired automatically with `Spectrum Type` set to `Foreground` and `Background` respectively and `Synthesize Background` unchecked. Standalone foreground files enable `Synthesize Background` automatically.
- **Nuisance / Background-Only Spectra:** Include unalarmed background or nuisance `.spe` and `.n42` files directly alongside source spectra. They require no special naming, though files with `bg`, `bkg`, or `background` in their filename are tagged with `Spectrum Type = Background` when uploaded.

---

## 3. How Auto-Adjudication Selects Isotopes & Disposition Codes

During each full-detail adjudication (`pwa-notification-detail` and `event-log-filter-detail` in `ui-endurance`, plus spectroscopic checks in `adjudication`):

1. **Deterministic Round-Robin Rotation:** Samples are interleaved round-robin across device subdirectories so consecutive adjudications exercise diverse RIID models, `.spe` and `.n42` formats, active sources, and nuisance spectra.
2. **Upload & OSCAR Display Verification:** The runner attaches the sample on `Event Details`, verifies `WebID` controls (`Detector Response Function = auto`, `Spectrum Type`, `Synthesize Background`), clicks **Upload to WebID**, and verifies that OSCAR renders the uploaded spectrum in the **`N42 Report`** section (`[data-testid="n42-report-section"]`).
3. **WebID Analysis & Operator Isotope Selection:**
   - **Highest-Confidence WebID Result (Primary):** When Sandia WebID is reachable and returns identified nuclides in **`WebID Analysis Results`** (`[data-testid="webid-analysis-section"]`), the Viewer ranks the highest-confidence WebID analysis and the runner clicks **Use Selected Result** (`[data-testid="apply-webid-isotopes"]`) to populate the `Isotope` field just like an operator.
   - **OSCAR Device Report Result (Fallback):** When WebID is offline, unavailable, or returns no source nuclide, if the RIID file itself reported nuclide identifications in OSCAR's **`N42 Report`** (`Device-Identified Nuclides`), the runner clicks **Use Device Result** (`[data-testid="apply-n42-device-isotopes"]`) to select the device-reported isotope(s).
   - **Nuisance / Background Result:** When neither WebID nor the OSCAR device report identifies a threat/medical/industrial/NORM nuclide (for example on unalarmed nuisance/background spectra or `"No Source Found"` analyses), the runner leaves `Isotope` empty and adjudicates the event as **`Code 7: RIID/ASP Indicates Background Only`**.
4. **Category-Matched Disposition Codes (Populating UpSet Co-Occurrence Plots):** When one or more isotopes are selected, the runner selects the corresponding operator adjudication code (`Code 1: Contraband Found` for SNM, `Code 3: Medical Isotope Found` for Medical, `Code 5: Declared Commercial/Industrial Shipment` for Industrial, `Code 4: NORM Found` for NORM, or `Code 2: Other` for `Unknown`), with `Secondary Inspection = COMPLETED`. Over continuous endurance runs, this naturally populates real multi-category occupancy intersections for the interactive `/event-log` and `/report` UpSet plots as well as PDF/XLSX/JSON `Adjudication` and `Event` reports.
