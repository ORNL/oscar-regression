import {existsSync, openSync, readSync, closeSync, readdirSync, statSync} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";

export type SpectroscopicExtension = ".n42" | ".n42.xml" | ".spe" | ".xml";

export type SpectroscopicSpectrumRole = "foreground" | "background" | "companion-neutron";

export interface SpectroscopicFileEntry {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly extension: SpectroscopicExtension;
  readonly mimeType: string;
  readonly role: SpectroscopicSpectrumRole;
}

export interface SpectroscopicSample {
  readonly id: string;
  readonly groupKey: string;
  readonly primary: SpectroscopicFileEntry;
  readonly companion?: SpectroscopicFileEntry;
  readonly synthesizeBackground: boolean;
}

export interface SpectroscopicCatalog {
  readonly directory: string;
  readonly explicitlyConfigured: boolean;
  readonly samples: readonly SpectroscopicSample[];
}

export interface OperatorDispositionDecision {
  readonly adjudicationCodeLabel: string;
  readonly expectedCodePrefix: string;
  readonly category: "SNM" | "Medical" | "Industrial" | "NORM" | "Unknown" | "BackgroundOnly";
}

export const CODE_1_CONTRABAND_LABEL = "Code 1: Contraband Found";
export const CODE_2_OTHER_LABEL = "Code 2: Other";
export const CODE_3_MEDICAL_LABEL = "Code 3: Medical Isotope Found";
export const CODE_4_NORM_LABEL = "Code 4: NORM Found";
export const CODE_5_INDUSTRIAL_LABEL = "Code 5: Declared Shipment of Radioactive Material";
export const CODE_7_BACKGROUND_ONLY_LABEL = "Code 7: RIID/ASP Indicates Background Only";

const SNM_LABELS = new Set([
  "neptunium",
  "neptunium-237",
  "plutonium",
  "uranium",
  "uranium-233",
  "uranium-235",
  "uranium-238",
  "americium",
  "californium",
]);

const MEDICAL_LABELS = new Set([
  "fluorine",
  "fluorine-18",
  "gallium",
  "gallium-67",
  "iodine-123",
  "iodine-125",
  "iodine-131",
  "iodine123",
  "iodine131",
  "indium",
  "indium-111",
  "lutetium-177",
  "molybdenum-99",
  "palladium",
  "palladium-103",
  "samarium-153",
  "technetium",
  "technetium-99m",
  "thallium-201",
  "xenon",
  "xenon-133",
]);

const NORM_LABELS = new Set([
  "potassium",
  "potassium-40",
  "radium",
  "radium-226",
  "thorium",
  "thorium-232",
  "bismuth",
  "bismuth-214",
]);

const INDUSTRIAL_LABELS = new Set([
  "barium",
  "barium-133",
  "cesium-134",
  "cesium-137",
  "cesium134",
  "cesium137",
  "cobalt-57",
  "cobalt-60",
  "cobalt57",
  "cobalt60",
  "europium-152",
  "europium152",
  "iridium",
  "iridium-192",
  "manganese",
  "manganese-54",
  "selenium",
  "selenium-75",
  "sodium",
  "sodium-22",
  "strontium",
  "strontium-90",
]);

const SPECTROSCOPIC_XML_HEADER_RE = /<(?:[\w-]+:)?(?:RadInstrumentData|N42InstrumentData|RadSamplerData)\b/i;
const BACKGROUND_NAME_RE = /(?:^|[\s._~()-])(?:bg|bkg|background)(?:$|[\s._~()-])/i;
const FOREGROUND_PAIR_RE = /^(.*?)([._~ -])(?:fg|foreground)(\.(?:n42\.xml|n42|spe|xml))$/i;
const BACKGROUND_PAIR_RE = /^(.*?)([._~ -])(?:bg|bkg|background)(\.(?:n42\.xml|n42|spe|xml))$/i;
const GAMMA_PAIR_RE = /^(.*?)([._~ -])gamma(\.spe)$/i;
const NEUTRON_PAIR_RE = /^(.*?)([._~ -])neutron(\.spe)$/i;

function classifyExtension(fileName: string): SpectroscopicExtension | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".n42.xml")) return ".n42.xml";
  if (lower.endsWith(".n42")) return ".n42";
  if (lower.endsWith(".spe")) return ".spe";
  if (lower.endsWith(".xml")) return ".xml";
  return null;
}

function readHeaderSnippet(filePath: string, maxBytes = 4096): string {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function isSupportedSpectroscopicFile(filePath: string, ext: SpectroscopicExtension): boolean {
  if (ext === ".n42" || ext === ".n42.xml" || ext === ".spe") {
    return true;
  }
  // Plain .xml files must look like spectroscopic N42 or vendor RadSamplerData XML
  try {
    const snippet = readHeaderSnippet(filePath, 4096);
    return SPECTROSCOPIC_XML_HEADER_RE.test(snippet);
  } catch {
    return false;
  }
}

function mimeTypeForExtension(ext: SpectroscopicExtension): string {
  return ext === ".spe" ? "text/plain" : "application/xml";
}

function collectFilesRecursively(rootDir: string, currentDir: string, out: string[]): void {
  const entries = readdirSync(currentDir, {withFileTypes: true})
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collectFilesRecursively(rootDir, fullPath, out);
    } else if (entry.isFile()) {
      if (entry.name.toLowerCase() === "readme.md") continue;
      out.push(fullPath);
    }
  }
}

/**
 * Discovers secondary-inspection `.spe` and `.n42` (`.n42.xml`, spectroscopic `.xml`)
 * files from `explicitDir` (when provided via `--spectra-dir` or `OSCAR_SPECTRA_DIR`)
 * or `<cwd>/spectroscopic-files` by default.
 *
 * Companion `-gamma.spe` + `-neutron.spe` and `foreground` + `background` pairs in
 * the same folder are linked automatically, and samples are interleaved round-robin
 * across device/campaign subdirectories so consecutive adjudications exercise diverse
 * RIID formats, active isotopes, and nuisance spectra.
 */
export function discoverSpectroscopicCatalog(
  explicitDir?: string,
  defaultDir = resolve("spectroscopic-files"),
): SpectroscopicCatalog {
  const trimmedExplicit = explicitDir?.trim() ?? "";
  if (trimmedExplicit) {
    if (/[\0\r\n]/.test(trimmedExplicit)) {
      throw new Error("Spectroscopic directory path must not contain control characters");
    }
    const resolvedExplicit = resolve(trimmedExplicit);
    if (!existsSync(resolvedExplicit) || !statSync(resolvedExplicit).isDirectory()) {
      throw new Error(`Configured spectroscopic directory does not exist or is not a directory: ${resolvedExplicit}`);
    }
    return buildCatalogFromDirectory(resolvedExplicit, true);
  }

  if (!existsSync(defaultDir) || !statSync(defaultDir).isDirectory()) {
    return {
      directory: defaultDir,
      explicitlyConfigured: false,
      samples: [],
    };
  }
  return buildCatalogFromDirectory(defaultDir, false);
}

function buildCatalogFromDirectory(rootDir: string, explicitlyConfigured: boolean): SpectroscopicCatalog {
  const candidatePaths: string[] = [];
  collectFilesRecursively(rootDir, rootDir, candidatePaths);

  const validFiles: Array<{
    absPath: string;
    relPath: string;
    dirRel: string;
    fileName: string;
    ext: SpectroscopicExtension;
  }> = [];

  for (const absPath of candidatePaths) {
    const fileName = basename(absPath);
    const ext = classifyExtension(fileName);
    if (!ext) continue;
    if (!isSupportedSpectroscopicFile(absPath, ext)) continue;
    const relPath = relative(rootDir, absPath).replaceAll("\\", "/");
    const dirRel = dirname(relPath).replaceAll("\\", "/");
    validFiles.push({absPath, relPath, dirRel, fileName, ext});
  }

  const byRelPath = new Map(validFiles.map((f) => [f.relPath, f]));
  const consumed = new Set<string>();
  const rawSamples: SpectroscopicSample[] = [];

  for (const item of validFiles) {
    if (consumed.has(item.relPath)) continue;

    // Defer standalone -neutron.spe or _background files if their primary partner exists in the same folder
    const neutronMatch = item.fileName.match(NEUTRON_PAIR_RE);
    if (neutronMatch) {
      const partnerName = `${neutronMatch[1]}${neutronMatch[2]}gamma${neutronMatch[3]}`;
      const partnerRel = item.dirRel === "." ? partnerName : `${item.dirRel}/${partnerName}`;
      if (byRelPath.has(partnerRel)) {
        continue;
      }
    }

    const bgPairMatch = item.fileName.match(BACKGROUND_PAIR_RE);
    if (bgPairMatch) {
      const fgCandidates = [
        `${bgPairMatch[1]}${bgPairMatch[2]}fg${bgPairMatch[3]}`,
        `${bgPairMatch[1]}${bgPairMatch[2]}foreground${bgPairMatch[3]}`,
      ];
      const hasFgPartner = fgCandidates.some((cand) =>
        byRelPath.has(item.dirRel === "." ? cand : `${item.dirRel}/${cand}`));
      if (hasFgPartner) {
        continue;
      }
    }

    consumed.add(item.relPath);
    let companionEntry: SpectroscopicFileEntry | undefined;

    const gammaMatch = item.fileName.match(GAMMA_PAIR_RE);
    if (gammaMatch) {
      const partnerName = `${gammaMatch[1]}${gammaMatch[2]}neutron${gammaMatch[3]}`;
      const partnerRel = item.dirRel === "." ? partnerName : `${item.dirRel}/${partnerName}`;
      const partner = byRelPath.get(partnerRel);
      if (partner && !consumed.has(partner.relPath)) {
        consumed.add(partner.relPath);
        companionEntry = {
          absolutePath: partner.absPath,
          relativePath: partner.relPath,
          fileName: partner.fileName,
          extension: partner.ext,
          mimeType: mimeTypeForExtension(partner.ext),
          role: "companion-neutron",
        };
      }
    }

    const fgPairMatch = item.fileName.match(FOREGROUND_PAIR_RE);
    if (!companionEntry && fgPairMatch) {
      const bgCandidates = [
        `${fgPairMatch[1]}${fgPairMatch[2]}bg${fgPairMatch[3]}`,
        `${fgPairMatch[1]}${fgPairMatch[2]}bkg${fgPairMatch[3]}`,
        `${fgPairMatch[1]}${fgPairMatch[2]}background${fgPairMatch[3]}`,
      ];
      for (const cand of bgCandidates) {
        const partnerRel = item.dirRel === "." ? cand : `${item.dirRel}/${cand}`;
        const partner = byRelPath.get(partnerRel);
        if (partner && !consumed.has(partner.relPath)) {
          consumed.add(partner.relPath);
          companionEntry = {
            absolutePath: partner.absPath,
            relativePath: partner.relPath,
            fileName: partner.fileName,
            extension: partner.ext,
            mimeType: mimeTypeForExtension(partner.ext),
            role: "background",
          };
          break;
        }
      }
    }

    const isStandaloneBackground = !companionEntry && BACKGROUND_NAME_RE.test(item.fileName);
    const primaryRole: SpectroscopicSpectrumRole = isStandaloneBackground ? "background" : "foreground";
    const groupKey = deriveDeviceGroupKey(item.dirRel, item.fileName);

    rawSamples.push({
      id: item.relPath,
      groupKey,
      primary: {
        absolutePath: item.absPath,
        relativePath: item.relPath,
        fileName: item.fileName,
        extension: item.ext,
        mimeType: mimeTypeForExtension(item.ext),
        role: primaryRole,
      },
      ...(companionEntry ? {companion: companionEntry} : {}),
      synthesizeBackground: primaryRole === "foreground" && companionEntry?.role !== "background",
    });
  }

  return {
    directory: rootDir,
    explicitlyConfigured,
    samples: interleaveSamplesByGroup(rawSamples),
  };
}

function deriveDeviceGroupKey(dirRel: string, fileName: string): string {
  if (dirRel && dirRel !== ".") {
    const segments = dirRel.split("/").filter(Boolean);
    return segments[segments.length - 1]!;
  }
  const stem = fileName.split(/[._~ -]/)[0]?.trim();
  return stem || "root";
}

function interleaveSamplesByGroup(samples: readonly SpectroscopicSample[]): SpectroscopicSample[] {
  if (samples.length <= 1) return [...samples];
  const buckets = new Map<string, SpectroscopicSample[]>();
  for (const sample of samples) {
    let list = buckets.get(sample.groupKey);
    if (!list) {
      list = [];
      buckets.set(sample.groupKey, list);
    }
    list.push(sample);
  }
  const sortedKeys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  const interleaved: SpectroscopicSample[] = [];
  let added = true;
  let depth = 0;
  while (added) {
    added = false;
    for (const key of sortedKeys) {
      const bucket = buckets.get(key)!;
      if (depth < bucket.length) {
        interleaved.push(bucket[depth]!);
        added = true;
      }
    }
    depth++;
  }
  return interleaved;
}

export function selectSpectroscopicSampleForCycle(
  catalog: SpectroscopicCatalog,
  cycleIndex: number,
): SpectroscopicSample | null {
  if (catalog.samples.length === 0) return null;
  const safeIndex = Math.abs(Math.trunc(cycleIndex)) % catalog.samples.length;
  return catalog.samples[safeIndex] ?? null;
}

/**
 * Maps the rendered isotope labels in OSCAR's `IsotopeSelect` control (populated from
 * the highest-confidence WebID result or OSCAR's N42 device report) to the matching
 * operator adjudication disposition code. When neither WebID nor the RIID device report
 * identifies a source isotope (such as unalarmed nuisance/background spectra), returns
 * `Code 7: RIID/ASP Indicates Background Only`.
 */
export function resolveOperatorDispositionFromSelectedIsotopes(
  renderedIsotopeText: string,
): OperatorDispositionDecision {
  const tokens = renderedIsotopeText
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (tokens.length === 0) {
    return {
      adjudicationCodeLabel: CODE_7_BACKGROUND_ONLY_LABEL,
      expectedCodePrefix: "Code 7",
      category: "BackgroundOnly",
    };
  }

  let sawMedical = false;
  let sawIndustrial = false;
  let sawNorm = false;
  let sawUnknown = false;

  for (const token of tokens) {
    if (SNM_LABELS.has(token) || token.startsWith("uranium") || token.startsWith("plutonium") || token.startsWith("neptunium")) {
      return {
        adjudicationCodeLabel: CODE_1_CONTRABAND_LABEL,
        expectedCodePrefix: "Code 1",
        category: "SNM",
      };
    }
    if (MEDICAL_LABELS.has(token) || token.startsWith("iodine") || token.startsWith("technetium")) {
      sawMedical = true;
    } else if (INDUSTRIAL_LABELS.has(token) || token.startsWith("cesium") || token.startsWith("cobalt") || token.startsWith("europium")) {
      sawIndustrial = true;
    } else if (NORM_LABELS.has(token)) {
      sawNorm = true;
    } else if (token === "unknown") {
      sawUnknown = true;
    }
  }

  if (sawMedical) {
    return {
      adjudicationCodeLabel: CODE_3_MEDICAL_LABEL,
      expectedCodePrefix: "Code 3",
      category: "Medical",
    };
  }
  if (sawIndustrial) {
    return {
      adjudicationCodeLabel: CODE_5_INDUSTRIAL_LABEL,
      expectedCodePrefix: "Code 5",
      category: "Industrial",
    };
  }
  if (sawNorm) {
    return {
      adjudicationCodeLabel: CODE_4_NORM_LABEL,
      expectedCodePrefix: "Code 4",
      category: "NORM",
    };
  }
  if (sawUnknown) {
    return {
      adjudicationCodeLabel: CODE_2_OTHER_LABEL,
      expectedCodePrefix: "Code 2",
      category: "Unknown",
    };
  }

  return {
    adjudicationCodeLabel: CODE_2_OTHER_LABEL,
    expectedCodePrefix: "Code 2",
    category: "Unknown",
  };
}
