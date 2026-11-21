# Bundled Synthetic WCO `UFF 2.0` & `UFF 3.0.0` Cargo NII Sample Packages (`CC0-1.0`)

These four `.uff` packages are **100% mathematically synthesized** from Beer-Lambert dual-energy attenuation physics (`6 MeV` / `4 MeV` Bremsstrahlung transmission + effective atomic-number `Z_eff` material models) with **zero real border-crossing imagery, zero third-party dataset pixels, and zero personally identifiable information**. They are released under **`CC0-1.0` (Public Domain Dedication)** so operators, evaluators, and CI runners cloning `ORNL/oscar-regression` can immediately test OSCAR's 16-bit Cargo X-Ray & HEMD inspector out of the box without needing access to restricted government NII scan archives.

Each package contains a true **16-bit unsigned grayscale TIFF** (`2048 × 600`, `uint16`, Deflate-compressed), an 8-bit palettized **HEMD** effective-`Z` overlay PNG (`UFF 3.0.0`), a progressive `820 × 240` `preview.jpg`, `SHA3-384` `<Hash>` digests, and XSD-validated WCO `UFF 2.0` / `UFF 3.0.0` XML descriptors:

| File | Standard | Metadata Tier | UFF UUID | Container / OCR | Attachments & Scenario |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `01-uff2-sparse-unlabelled-norm-cargo.uff` | `UFF 2.0` | **Tier 1 (Sparse)** | `3889134c-dd1f-4d03-9399-0ca25f6f01b8` | *(Unlabelled — no OCR / declaration in XML)* | Homogeneous NORM cargo radiograph + `preview.jpg`. Exercises commercial **Tier-1 UUID / filename lookup** and scanner/time-window browsing when no OCR or customs declaration is present. |
| `02-uff3-fuzzy-ocr-eghu3972g94-norm.uff` | `UFF 3.0.0` | **Tier 2 (Noisy OCR)** | `393a7a3f-a3f2-46a3-988a-3f21bf99857c` | `EGHU3972G94` *(1-char `6↔G` OCR noise for `EGHU3972694`)* | `UFF 3.0.0` 16-bit TIFF + palettized HEMD (`Organic` / `Intermediate` / `Inorganic` `<ZMap>` bands) + OCR crop JPEGs. Exercises **1-character fuzzy OCR correlation (`OCR ±1`)** against OSCAR's canonical `EGHU3972694` container lane. |
| `03-uff3-full-manifest-n42-norm-cargo.uff` | `UFF 3.0.0` | **Tier 3 (Full BENIGN NORM)** | `772e9494-96b1-433b-902e-fb39a864edc6` | `RSTU2402941` | Complete `UFF 3.0.0` customs `<Declaration>`, Bill of Lading **Manifest `.pdf`**, OCR crops, and embedded **ANSI N42.42 (`.n42`)** NORM spectrum for automatic Sandia WebID / offline photopeak extraction. |
| `04-uff3-highz-shielded-anomaly-scfu8572724.uff` | `UFF 3.0.0` | **Tier 3 (Suspect High-Z Anomaly)** | `dfb985c4-eb26-41ab-938b-ad2a1f5966d4` | `SCFU8572724` | Low-density polypropylene cargo (`HS 3926.90`) containing a localized **`82 cm × 53 cm` High-Z metallic attenuation block** (`Z_eff <= 82`) flagged by `<Analysis>` `<Annotation>` bounding box (`Confidence = 94%`), plus Manifest `.pdf` and `.n42` radiation file. |

## Trying Them Out Manually in OSCAR Viewer

1. **Zero-Setup Local Upload (No SMB Share Needed):**
   - Open any occupancy in **Event Details (`/event-details`) -> Secondary Inspection**, click **Upload Files**, and select `04-uff3-highz-shielded-anomaly-scfu8572724.uff` (or `03-uff3-full-manifest-n42-norm-cargo.uff`).
   - OSCAR automatically extracts the embedded `.n42` spectrum for **WebID** analysis, populates untouched **Vehicle ID**, and enables **Inspect 16-Bit Radiograph**.
2. **Read-Only SMB Share / Mounted Directory Testing:**
   - Point `CARGO_UFF_SMB_SHARE` in `.env` at your larger commercial/synthetic SMBv2/SMBv3 dataset (or mount `uff-samples/` read-only into `/var/lib/oscar/extensions/uff/samples`) and run `CARGO_UFF_WORKFLOW=required ./scripts/run-regression.sh full --scenario cargo-uff`.
