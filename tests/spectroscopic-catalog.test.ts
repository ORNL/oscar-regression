import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {
  CODE_1_CONTRABAND_LABEL,
  CODE_2_OTHER_LABEL,
  CODE_3_MEDICAL_LABEL,
  CODE_4_NORM_LABEL,
  CODE_5_INDUSTRIAL_LABEL,
  CODE_7_BACKGROUND_ONLY_LABEL,
  discoverSpectroscopicCatalog,
  resolveOperatorDispositionFromSelectedIsotopes,
  selectSpectroscopicSampleForCycle,
} from "../src/spectroscopic-catalog.js";
import {parseUiEnduranceCliArgs} from "../src/ui-endurance-oracles.js";

test("discoverSpectroscopicCatalog returns empty catalog when default directory has only README.md", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "oscar-spectra-empty-"));
  try {
    writeFileSync(join(tempRoot, "README.md"), "# Tracked README\n", "utf8");
    const catalog = discoverSpectroscopicCatalog(undefined, tempRoot);
    assert.equal(catalog.explicitlyConfigured, false);
    assert.equal(catalog.samples.length, 0);
    assert.equal(selectSpectroscopicSampleForCycle(catalog, 0), null);
  } finally {
    rmSync(tempRoot, {recursive: true, force: true});
  }
});

test("discoverSpectroscopicCatalog pairs gamma+neutron .spe, fg+bg .n42, filters non-spectroscopic .xml, and interleaves devices", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "oscar-spectra-multi-"));
  try {
    mkdirSync(join(tempRoot, "SNIPER-GN"), {recursive: true});
    mkdirSync(join(tempRoot, "R225"), {recursive: true});
    mkdirSync(join(tempRoot, "Syclone"), {recursive: true});

    writeFileSync(join(tempRoot, "README.md"), "# Ignored README\n", "utf8");
    writeFileSync(join(tempRoot, "Syclone", "maven-pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>", "utf8");
    writeFileSync(
      join(tempRoot, "Syclone", "50310N_2025.xml"),
      "<?xml version=\"1.0\"?><RadSamplerData><SampleData/></RadSamplerData>",
      "utf8",
    );

    writeFileSync(join(tempRoot, "SNIPER-GN", "ID-01-gamma.spe"), "$SPEC_ID:\n$DATA:\n0 3\n1 2 3 4\n", "utf8");
    writeFileSync(join(tempRoot, "SNIPER-GN", "ID-01-neutron.spe"), "$SPEC_ID:\n$DATA:\n0 1\n0 0\n", "utf8");

    writeFileSync(join(tempRoot, "R225", "pass1_foreground.n42"), "<RadInstrumentData/>", "utf8");
    writeFileSync(join(tempRoot, "R225", "pass1_background.n42"), "<RadInstrumentData/>", "utf8");
    writeFileSync(join(tempRoot, "R225", "ambient_bkg_02.n42.xml"), "<RadInstrumentData/>", "utf8");

    const catalog = discoverSpectroscopicCatalog(tempRoot);
    assert.equal(catalog.explicitlyConfigured, true);
    assert.equal(catalog.samples.length, 4);

    // Interleaved across R225, SNIPER-GN, Syclone on first pass
    const firstThreeGroups = catalog.samples.slice(0, 3).map((s) => s.groupKey);
    assert.deepEqual(firstThreeGroups, ["R225", "SNIPER-GN", "Syclone"]);

    const sniper = catalog.samples.find((s) => s.groupKey === "SNIPER-GN");
    assert.ok(sniper);
    assert.equal(sniper.primary.fileName, "ID-01-gamma.spe");
    assert.equal(sniper.companion?.fileName, "ID-01-neutron.spe");
    assert.equal(sniper.companion?.role, "companion-neutron");

    const fgBgPair = catalog.samples.find((s) => s.primary.fileName === "pass1_foreground.n42");
    assert.ok(fgBgPair);
    assert.equal(fgBgPair.companion?.fileName, "pass1_background.n42");
    assert.equal(fgBgPair.companion?.role, "background");
    assert.equal(fgBgPair.synthesizeBackground, false);

    const standaloneBg = catalog.samples.find((s) => s.primary.fileName === "ambient_bkg_02.n42.xml");
    assert.ok(standaloneBg);
    assert.equal(standaloneBg.primary.role, "background");
    assert.equal(standaloneBg.synthesizeBackground, false);
  } finally {
    rmSync(tempRoot, {recursive: true, force: true});
  }
});

test("resolveOperatorDispositionFromSelectedIsotopes maps WebID/device isotopes and nuisance empty results", () => {
  assert.deepEqual(resolveOperatorDispositionFromSelectedIsotopes(""), {
    adjudicationCodeLabel: CODE_7_BACKGROUND_ONLY_LABEL,
    expectedCodePrefix: "Code 7",
    category: "BackgroundOnly",
  });
  assert.deepEqual(resolveOperatorDispositionFromSelectedIsotopes("Plutonium, Iodine-131"), {
    adjudicationCodeLabel: CODE_1_CONTRABAND_LABEL,
    expectedCodePrefix: "Code 1",
    category: "SNM",
  });
  assert.deepEqual(resolveOperatorDispositionFromSelectedIsotopes("Iodine-131, Potassium"), {
    adjudicationCodeLabel: CODE_3_MEDICAL_LABEL,
    expectedCodePrefix: "Code 3",
    category: "Medical",
  });
  assert.deepEqual(resolveOperatorDispositionFromSelectedIsotopes("Barium, Cesium-137, Potassium"), {
    adjudicationCodeLabel: CODE_5_INDUSTRIAL_LABEL,
    expectedCodePrefix: "Code 5",
    category: "Industrial",
  });
  assert.deepEqual(resolveOperatorDispositionFromSelectedIsotopes("Potassium"), {
    adjudicationCodeLabel: CODE_4_NORM_LABEL,
    expectedCodePrefix: "Code 4",
    category: "NORM",
  });
  assert.deepEqual(resolveOperatorDispositionFromSelectedIsotopes("Unknown"), {
    adjudicationCodeLabel: CODE_2_OTHER_LABEL,
    expectedCodePrefix: "Code 2",
    category: "Unknown",
  });
});

test("parseUiEnduranceCliArgs accepts --spectra-dir and OSCAR_SPECTRA_DIR", () => {
  const fromFlag = parseUiEnduranceCliArgs(["--max-cycles", "4", "--spectra-dir", "/tmp/my-spectra"], {});
  assert.equal(fromFlag.spectraDir, "/tmp/my-spectra");

  const fromEnv = parseUiEnduranceCliArgs([], {OSCAR_SPECTRA_DIR: "/srv/riid-spectra"});
  assert.equal(fromEnv.spectraDir, "/srv/riid-spectra");
});
