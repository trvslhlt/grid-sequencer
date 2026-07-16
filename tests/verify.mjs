// Manual (non-CI) golden-path browser check: unlock audio, toggle cells,
// select each panel kind (cell/row/column/master) and exercise its
// override fields and sections (Defaults/Envelope/Effects, including that
// row/column precedence only tie-breaks between two *active* overrides --
// never lets one side win unconditionally regardless of its own toggle),
// drag an Envelope section's breakpoint-curve editor and confirm it persists, a sample
// row's playback range view (drag handles trim which portion of the
// buffer plays, also persisted) and its "Reverse playback" checkbox (a
// non-destructive playback-direction flip, keeps working after
// reassigning a different sample while it's on, persists through a patch
// save/reload), the main page's select-only Sample/Instrument Library
// panels (collapsible trees, click-to-assign onto the selected row,
// instrument presets grey out on a source-type mismatch), the library
// management page (in-app toggle, not a route -- full CRUD: add/rename/
// re-categorize/permanently-reverse/delete a sample, edit/delete an
// instrument preset, rename/edit/delete an effect chain preset), the explicitDuration
// trigger mode's steps-based duration field, the modular effects chain
// (no effects at any level -- row/cell/master alike -- by default; add
// any of the 6 types as needed, including multiple instances of the same
// type, e.g. two delays) and *every* one of each type's own params,
// including ones added after an "expose all available params" pass
// (filter gain, compressor knee, tremolo/ring-mod's full non-custom
// waveform set), the Effect Library (save a whole configured chain,
// apply it additively to a different row/cell/master) -- FmSynth's and
// GranularSynth's own
// previously-under-exposed params (carrier/modulator waveform; every grain
// param, not just density/pitch-jitter), the shared reverb bus's own
// decay/pre-delay/damping (previously hardcoded with no UI at all, now
// live-adjustable and persisted through patches), add one of each of the
// 5 source types (GranularSynth exercises its async worklet init), flip
// row/column precedence, tempo, step count, and the global key/scale
// (playback keeps working, note fields stay untouched by the silent
// snap), patch persistence (save under a name, reload the page for a
// genuinely fresh context, confirm "demo" loads by default and the saved
// patch round-trips through the real backend), recording audio out to a
// real WAV download, and play -- all with zero console errors.
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.BASE_URL ?? "http://localhost:5173";

const errors = [];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok: ${message}`);
}

/** A panel section (Defaults/Envelope/Effects) is a titled group with its
 * own header toggle button and a dimmable body -- distinct from the
 * per-cell "override" field above, this is the row/column-level "one
 * button governs the whole group" pattern. */
function section(page, title) {
  const root = page.locator(".panel-section", { hasText: title });
  return {
    root,
    button: root.locator(".panel-header-button"),
    body: root.locator(".dimmed-section"),
    field(label) {
      return root.locator(".panel-field", { hasText: label });
    },
    // Envelope sections render one "automation" field -- a breakpoint-curve
    // editor (see fields.ts) rather than plain inputs.
    automationSvg() {
      return root.locator(".automation-svg");
    },
    // Modular effects chain helpers (see addEffect/removeEffectButton/
    // effectParam/saveChainPresetButton below), scoped to this section.
    addEffect(type) {
      return addEffect(root, type);
    },
    removeEffectButton(typeLabel) {
      return removeEffectButton(root, typeLabel);
    },
    effectParam(paramLabel) {
      return effectParam(root, paramLabel);
    },
    saveChainPresetButton() {
      return saveChainPresetButton(root);
    },
  };
}

/** effectsFields (see gridView.ts) renders a chain as a plain ordered
 * list -- no effects by default at any level (row/cell/master alike):
 * each already-added instance renders as its own "<Type> — Remove"
 * button (its own heading, doubling as removal), followed by that
 * instance's own params, unprefixed (just "Cutoff (Hz)", not "Filter:
 * Cutoff (Hz)" -- the Remove button already reads as that group's
 * heading), then a shared "Add effect…" type picker + "Add" button
 * (appends a fresh default instance -- nothing stops the same type being
 * added twice) and, once the chain is non-empty, "Save chain as
 * preset…". */
function effectAddSelect(scope) {
  return scope
    .locator(".panel-field", { hasText: "Add effect…" })
    .locator("select");
}
function effectAddButton(scope) {
  return scope.locator("button", { hasText: /^Add$/ });
}
async function addEffect(scope, type) {
  await effectAddSelect(scope).selectOption(type);
  await effectAddButton(scope).click();
}
function removeEffectButton(scope, typeLabel) {
  return scope.locator("button", { hasText: `${typeLabel} — Remove` });
}
function saveChainPresetButton(scope) {
  return scope.locator("button", { hasText: "Save chain as preset…" });
}

/** One of an effect instance's own param fields, by its own (unprefixed)
 * label -- always interactive, chain empty or not, override dimmed or
 * not. Every param label is unique app-wide *except* "Wet" (every effect
 * type has one) and any label shared by two instances of the *same*
 * type (e.g. two Delays' "Time (ms)") -- scope narrowly, or pick a
 * different param, when that matters. */
function effectParam(scope, paramLabel) {
  return scope.locator(".panel-field", { hasText: paramLabel });
}

/** Drags an automation editor's Nth handle to roughly (fracX, fracY) of the
 * SVG's own bounding box and returns its resulting cy attribute, so a
 * caller can assert the same position survives a reselect. */
async function dragAutomationHandle(page, svg, index, fracX, fracY) {
  const svgBox = await svg.boundingBox();
  const handle = svg.locator(".automation-handle").nth(index);
  const handleBox = await handle.boundingBox();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    svgBox.x + svgBox.width * fracX,
    svgBox.y + svgBox.height * fracY,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.waitForTimeout(50);
  return handle.getAttribute("cy");
}

/** A minimal valid mono 16-bit PCM WAV (0.1s of silence at 44100Hz) -- just
 * needs to survive decodeAudioData for the "upload a local file" half of
 * the sample-library test, same header shape as src/wavEncoder.ts. */
async function writeTinyWavFixture() {
  const sampleRate = 44100;
  const samples = Math.round(sampleRate * 0.1);
  const dataSize = samples * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  function writeString(offset, text) {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  const filePath = path.join(os.tmpdir(), `verify-tiny-${Date.now()}.wav`);
  await writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}

const browser = await chromium.launch();
const page = await browser.newPage();

page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("requestfailed", (req) =>
  errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`),
);
// Every dialog-triggering action below attaches its own page.once("dialog",
// ...) immediately before the click that opens it -- not a single global
// page.on("dialog", ...) handler, since this file also drives window.prompt()
// dialogs (rename/save-preset flows) that need real text typed into them,
// and a blanket handler registered once at the top would race every later
// one to resolve each dialog first (with no text), not just confirm()'s.

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.click("#unlock button");
await page.waitForSelector("#app:not(.hidden)");
// #app losing .hidden only means the audio-unlock step finished -- demo
// seeding/loading happens after that, via the backend (see main.ts), so
// the grid itself isn't populated yet until a row actually appears.
await page.waitForSelector(".row-master");
// A short settle beyond the first row appearing -- render() now does
// noticeably more synchronous work per call than it used to (many more
// per-source param fields, plus the two new library trees rebuilding on
// every selection change), and the JS engine hasn't warmed up on this
// page's own render path yet this early, so the very first few
// interactions below were intermittently racing ahead of it.
await page.waitForTimeout(300);

const rowCount = await page.locator(".row-master").count();
if (rowCount !== 5) fail(`expected 5 starter rows, found ${rowCount}`);
else ok("5 starter rows loaded");

const columnCount = await page.locator(".column-master").count();
if (columnCount !== 8) fail(`expected 8 columns, found ${columnCount}`);
else ok("8 columns loaded");

// Nothing selected initially -- a hint, not an empty/broken-looking panel.
if ((await page.locator(".panel-hint").count()) === 0) {
  fail("expected a hint in the panel before anything is selected");
} else {
  ok("panel shows a hint before anything is selected");
}

// Cell toggle (left-click; unrelated to selection/panel).
const firstCell = page.locator(".cell").first();
const before = (await firstCell.getAttribute("class")) ?? "";
await firstCell.click();
const after = (await firstCell.getAttribute("class")) ?? "";
if (before.includes("on") === after.includes("on")) {
  fail("clicking a cell did not toggle its on/off state");
} else {
  ok("cell toggles on/off");
}

// Select the cell (right-click) -- panel shows its fields, grid marks it.
// waitForSelector, not a fixed timeout -- render() now does noticeably
// more synchronous work per call than it used to (many more per-source
// param fields, plus the two library trees rebuilding on every selection
// change), and this file's early checks run before the JS engine has
// warmed up on this page's own render path, so a fixed 50ms buffer that
// used to be comfortable started intermittently losing the race here.
await firstCell.click({ button: "right" });
await page.waitForSelector(".cell.selected", { timeout: 2000 });
if (!(await firstCell.evaluate((el) => el.classList.contains("selected")))) {
  fail("selecting a cell did not mark it .selected in the grid");
} else {
  ok("selecting a cell marks it in the grid");
}
const cellTitle = await page.locator(".panel-title").textContent();
if (!cellTitle?.startsWith("Cell:")) {
  fail(`expected a "Cell: ..." panel title, got "${cellTitle}"`);
} else {
  ok("cell panel title identifies row and column");
}

// Select the "Kick" row.
await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForTimeout(50);
if ((await page.locator(".panel-title").textContent()) !== "Row: Kick") {
  fail("row panel title should read exactly 'Row: Kick'");
} else {
  ok("row panel title identifies the row");
}

// Defaults/Envelope are consolidated single-toggle sections -- a row or
// column only contributes a field's default when its own Override is on;
// global precedence is purely a tie-breaker for when *both* a row and a
// column are actively overriding the same field, never a way for one
// side to win unconditionally regardless of its own toggle state (that
// was a real bug: it made the *other* side's Override button silently
// inert). So neither button is ever precedence-disabled.
const rowDefaults = section(page, "Defaults");
const rowEnvelope = section(page, "Envelope");
if (await rowDefaults.button.isDisabled()) {
  fail("row Defaults button should never be precedence-disabled");
}
if (await rowEnvelope.button.isDisabled()) {
  fail("row Envelope button should never be precedence-disabled");
} else {
  ok("row Defaults/Envelope buttons are never precedence-disabled");
}

// Regression test for that bug: with the row's own Defaults off (never
// touched) and the default global precedence ("Row wins"), a column-level
// override should still actually take effect on a cell in that column --
// previously the row's raw (untouched) default silently won regardless.
await page.locator(".column-master").first().click({ button: "right" });
await page.waitForTimeout(50);
let columnDefaults = section(page, "Defaults");
await columnDefaults.button.click();
await page.waitForTimeout(50);
const columnNoteProbe = columnDefaults
  .field("Default note")
  .locator("input[type=number]");
await columnNoteProbe.fill("90");
await columnNoteProbe.dispatchEvent("change");
await page.waitForTimeout(50);
await firstCell.click({ button: "right" });
await page.waitForTimeout(50);
const cellNoteInput = page
  .locator(".panel-field", { hasText: "Note" })
  .locator("input[type=range]");
if ((await cellNoteInput.inputValue()) !== "90") {
  fail(
    `column-only override should win over an untouched row default: expected note 90, got ${await cellNoteInput.inputValue()}`,
  );
} else {
  ok(
    "a column-only override actually takes effect (row has precedence but no override of its own)",
  );
}
// Now also switch the row's own Defaults on with a different value --
// with row holding global precedence and *both* sides now active,
// precedence should tie-break in the row's favor.
await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForTimeout(50);
await rowDefaults.button.click();
await page.waitForTimeout(50);
const rowNoteProbe = rowDefaults
  .field("Default note")
  .locator("input[type=number]");
await rowNoteProbe.fill("50");
await rowNoteProbe.dispatchEvent("change");
await page.waitForTimeout(50);
await firstCell.click({ button: "right" });
await page.waitForTimeout(50);
if ((await cellNoteInput.inputValue()) !== "50") {
  fail(
    `with both row and column actively overriding, row's own precedence should win the tie: expected note 50, got ${await cellNoteInput.inputValue()}`,
  );
} else {
  ok(
    "with both sides actively overriding, global precedence tie-breaks correctly",
  );
}

// Column doesn't have precedence by default -- exercise the full
// toggle-on, set-value, persist-across-reselection path there too.
await page.locator(".column-master").first().click({ button: "right" });
await page.waitForTimeout(50);
columnDefaults = section(page, "Defaults");
const columnEnvelope = section(page, "Envelope");
if (await columnDefaults.button.isDisabled()) {
  fail("column Defaults button should never be precedence-disabled");
}
if (
  !(await columnDefaults.button.evaluate((el) =>
    el.classList.contains("active"),
  ))
) {
  fail("column Defaults button did not activate");
}
const columnNoteInput = columnDefaults
  .field("Default note")
  .locator("input[type=number]");
await columnNoteInput.fill("72");
await columnNoteInput.dispatchEvent("input");
await page.waitForTimeout(50);

await columnEnvelope.button.click();
await page.waitForTimeout(50);
const columnHandleCount = await columnEnvelope
  .automationSvg()
  .locator(".automation-handle")
  .count();
if (columnHandleCount !== 4) {
  fail(
    `column Envelope should start with 4 breakpoints (BUILT_INS default), found ${columnHandleCount}`,
  );
}
const columnAttackCyBefore = await dragAutomationHandle(
  page,
  columnEnvelope.automationSvg(),
  1,
  0.3,
  0.2,
);

// Reselect away and back to force a render from live model state.
await page.locator(".column-master").nth(1).click({ button: "right" });
await page.waitForTimeout(50);
await page.locator(".column-master").first().click({ button: "right" });
await page.waitForTimeout(50);
const columnDefaultsAfter = section(page, "Defaults");
const columnEnvelopeAfter = section(page, "Envelope");
if (
  !(await columnDefaultsAfter.button.evaluate((el) =>
    el.classList.contains("active"),
  ))
) {
  fail(
    "column Defaults override did not survive switching selection away and back",
  );
}
const columnNoteAfter = columnDefaultsAfter
  .field("Default note")
  .locator("input[type=number]");
if ((await columnNoteAfter.inputValue()) !== "72") {
  fail(
    `column Default note did not persist: expected 72, got ${await columnNoteAfter.inputValue()}`,
  );
}
const columnAttackCyAfter = await columnEnvelopeAfter
  .automationSvg()
  .locator(".automation-handle")
  .nth(1)
  .getAttribute("cy");
if (columnAttackCyAfter !== columnAttackCyBefore) {
  fail(
    `column Envelope breakpoint drag did not persist: expected cy ${columnAttackCyBefore}, got ${columnAttackCyAfter}`,
  );
} else {
  ok(
    "Defaults/Envelope section values and active state persist across reselection",
  );
}

// Flip global precedence with both row (note 50) and column (note 72)
// still actively overriding -- the tie-break winner should flip live,
// same regression this bug also broke.
await page.selectOption("#precedence-select", "column");
await firstCell.click({ button: "right" });
await page.waitForTimeout(50);
if ((await cellNoteInput.inputValue()) !== "72") {
  fail(
    `flipping precedence to column should flip the tie-break winner: expected note 72, got ${await cellNoteInput.inputValue()}`,
  );
} else {
  ok(
    "flipping global precedence live-flips the tie-break winner between two active overrides",
  );
}
await page.selectOption("#precedence-select", "row"); // restore

await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForTimeout(50);

// Rename via the panel; the grid label updates without needing to
// reselect anything.
await page
  .locator(".panel-field", { hasText: "Name" })
  .locator("input[type=text]")
  .fill("Kicker");
await page.keyboard.press("Tab");
await page.waitForTimeout(50);
if ((await page.locator(".row-master", { hasText: "Kicker" }).count()) === 0) {
  fail("renaming a row via the panel did not update its grid label");
} else {
  ok("row rename updates the grid label immediately");
}

// Sample playback range: a waveform view with two drag handles trims
// which portion of the loaded sample actually plays (see bruit-kit's
// SamplePlayer rangeStart/rangeEnd). Kicker (still selected) already has
// a generated sample loaded at startup, so the view should already be
// showing -- nothing to trim before a sample exists.
const rangeSvg = page.locator(".panel-field-wide .waveform-range-svg");
if ((await rangeSvg.count()) === 0) {
  fail("sample row with a loaded buffer should show a playback range view");
} else {
  const rangeHandles = rangeSvg.locator(".waveform-range-handle");
  if ((await rangeHandles.count()) !== 2) {
    fail(
      `expected 2 range handles (start/end), found ${await rangeHandles.count()}`,
    );
  } else {
    const svgBox = await rangeSvg.boundingBox();
    const startHandle = rangeHandles.nth(0);
    const startBox = await startHandle.boundingBox();
    await page.mouse.move(
      startBox.x + startBox.width / 2,
      startBox.y + startBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      svgBox.x + svgBox.width * 0.3,
      svgBox.y + svgBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForTimeout(50);
    const draggedX = await startHandle.getAttribute("x1");

    // Reselect away and back to force a render from live model state.
    await page
      .locator(".row-master", { hasText: "Synth" })
      .click({ button: "right" });
    await page.waitForTimeout(50);
    await page
      .locator(".row-master", { hasText: "Kicker" })
      .click({ button: "right" });
    await page.waitForTimeout(50);
    const persistedX = await page
      .locator(".panel-field-wide .waveform-range-svg .waveform-range-handle")
      .first()
      .getAttribute("x1");
    if (persistedX !== draggedX) {
      fail(
        `sample range drag did not persist: expected x1 ${draggedX}, got ${persistedX}`,
      );
    } else {
      ok("sample playback range view shows, drags, and persists");
    }
  }
}

// "Reverse playback" checkbox (samplePlayer rows only): a non-destructive
// playback-direction flip (see GridModel.setRowReversed) -- distinct from
// the Manage Library page's own permanent, destructive "Reverse" button
// tested further below. Still on Kicker. Left ON here (not toggled back
// off) so it carries into the "heavily-mutated state" patch-save/reload
// round-trip further down, same as the scale/reverb-decay changes there.
const reverseField = page.locator(".panel-field", {
  hasText: "Reverse playback",
});
if ((await reverseField.count()) === 0) {
  fail("sample row should show a Reverse playback checkbox");
} else {
  const reverseCheckbox = reverseField.locator("input[type=checkbox]");
  if (await reverseCheckbox.isChecked()) {
    fail("Reverse playback should start unchecked");
  }
  await reverseCheckbox.click();
  await page.waitForTimeout(50);
  await page.click("#play-button");
  await page.waitForTimeout(600);
  const playheadReversed = await page.evaluate(
    () => document.querySelectorAll(".cell.playhead").length,
  );
  await page.click("#stop-button");
  if (playheadReversed === 0) {
    fail("playhead stopped advancing with Reverse playback active");
  } else if (errors.length > 0) {
    fail(`errors with Reverse playback active:\n${errors.join("\n")}`);
  }
  // Reselect away and back to force a render from live model state.
  await page
    .locator(".row-master", { hasText: "Synth" })
    .click({ button: "right" });
  await page.waitForTimeout(50);
  await page
    .locator(".row-master", { hasText: "Kicker" })
    .click({ button: "right" });
  await page.waitForTimeout(50);
  if (
    !(await page
      .locator(".panel-field", { hasText: "Reverse playback" })
      .locator("input[type=checkbox]")
      .isChecked())
  ) {
    fail("Reverse playback checkbox did not survive a reselect");
  } else {
    ok(
      "Reverse playback toggles on, keeps playback working, and survives a reselect",
    );
  }
}

// Sample library: a select-only third-column panel now, not a per-row
// picker -- see main.ts's renderLibraryPanels/assignSampleToRow and
// libraryTree.ts. The row panel just shows a read-only "Sample" field.
const sampleField = page
  .locator(".panel-field", { hasText: "Sample" })
  .locator("input[type=text]");
if ((await sampleField.count()) === 0 || !(await sampleField.isDisabled())) {
  fail(
    'row panel should show a read-only "Sample" field, not loading controls',
  );
} else {
  ok('row panel shows a read-only "Sample" field');
}
if ((await page.locator("button:has-text('Load sample')").count()) !== 0) {
  fail('the old per-row "Load sample…" button should be gone');
} else {
  ok('per-row "Load sample…" button is gone (library-only now)');
}

async function expandGroup(containerSelector, label) {
  const summary = page.locator(`${containerSelector} summary`, {
    hasText: label,
  });
  await summary.click();
  await page.waitForTimeout(80);
}

await expandGroup("#sample-library", "percussion");
const percussionSamples = page.locator(
  "#sample-library .library-tree-item button",
);
if ((await percussionSamples.count()) === 0) {
  fail("sample library's percussion group has no items");
} else {
  ok("sample library groups by category, collapsed by default until expanded");
}

// Load a different sample onto Kicker (still selected) and confirm the
// waveform view updates (proof a new buffer actually loaded, not just a
// tree click with no effect). "Pad blip" is guaranteed to exist -- every
// fresh backend's demo seeding uploads it -- unlike anything from the
// separate, manually-run scripts/seed-sample-library.mjs, which `make
// verify` must not depend on.
await expandGroup("#sample-library", "pad");
await page
  .locator("#sample-library .library-tree-item button", { hasText: "Pad blip" })
  .click();
await page.waitForTimeout(400);
if ((await page.locator(".waveform-range-svg").count()) === 0) {
  fail("assigning a sample from the library did not leave a buffer loaded");
} else {
  ok("clicking a library sample assigns it to the selected row");
}
if ((await sampleField.inputValue()) !== "Pad blip") {
  fail(
    `row panel's read-only Sample field should now read "Pad blip", got "${await sampleField.inputValue()}"`,
  );
} else {
  ok("row panel's read-only Sample field reflects the newly-assigned sample");
}

// Clicking a sample with no row selected (or a non-sample row selected)
// should hint, not silently no-op or throw.
await page.locator("#master-button").click();
await page.waitForTimeout(50);
await page
  .locator("#sample-library .library-tree-item button", {
    hasText: "Kick blip",
  })
  .click();
await page.waitForTimeout(100);
if ((await page.locator(".library-hint").count()) === 0) {
  fail("clicking a library sample with no eligible row selected should hint");
} else {
  ok("clicking a library sample with nothing eligible selected shows a hint");
}

// Instrument presets: save one from an oscillatorSynth row (Synth), then
// confirm it only reads as usable (not .incompatible) on a same-source-
// type row, greying out on a different one.
await page
  .locator(".row-master", { hasText: "Synth" })
  .click({ button: "right" });
await page.waitForTimeout(50);
page.once("dialog", (dialog) => dialog.accept("Verify Preset"));
await page.locator("button", { hasText: "Save as instrument preset" }).click();
await page.waitForTimeout(400);

await expandGroup("#instrument-library", "Oscillator");
const presetItem = page.locator("#instrument-library .library-tree-item", {
  hasText: "Verify Preset",
});
if ((await presetItem.count()) === 0) {
  fail("saved instrument preset does not appear in the instrument library");
} else if (
  await presetItem.evaluate((el) => el.classList.contains("incompatible"))
) {
  fail(
    "preset should read as compatible while its own source-type row is selected",
  );
} else {
  ok(
    "saving an instrument preset makes it appear, usable, in the instrument library",
  );
}

await page
  .locator(".row-master", { hasText: "Bass" })
  .click({ button: "right" });
await page.waitForTimeout(50);
if (
  !(await page
    .locator("#instrument-library .library-tree-item", {
      hasText: "Verify Preset",
    })
    .evaluate((el) => el.classList.contains("incompatible")))
) {
  fail(
    "preset should read as incompatible once a different-source-type row is selected",
  );
} else {
  ok("instrument presets grey out on rows whose source type doesn't match");
}

await page
  .locator(".row-master", { hasText: "Kicker" })
  .click({ button: "right" });
await page.waitForTimeout(50);

// Trigger mode "explicitDuration" is expressed in grid steps, not seconds
// -- scales with tempo instead of needing hand re-tuning.
const triggerModeSelect = page
  .locator(".panel-field", { hasText: "Trigger mode" })
  .locator("select");
await triggerModeSelect.selectOption("explicitDuration");
await page.waitForTimeout(50);
const durationField = page.locator(".panel-field", {
  hasText: "Duration (steps)",
});
if ((await durationField.count()) === 0) {
  fail(
    'trigger mode "explicitDuration" should show a "Duration (steps)" field',
  );
} else {
  ok("explicitDuration trigger mode exposes duration in steps, not seconds");
}
await triggerModeSelect.selectOption("gatedToStep");
await page.waitForTimeout(50);

// Row panel's Effects section: no default chain, add each of the 6
// types one at a time and confirm each one's own full param list appears
// (not just a single headline param each) -- nothing conditionally
// appears/disappears as a side effect of *other* fields any more. Param
// labels are unprefixed (no "Filter: " before "Cutoff (Hz)") -- the
// "<Type> — Remove" button reads as that instance's own heading -- so
// "Wet" only needs checking once even though every effect type has one.
const rowPanel = page.locator(".selection-panel");
if ((await removeEffectButton(rowPanel, "Filter").count()) !== 0) {
  fail("a freshly-added row should start with no default effects chain");
} else {
  ok("row panel's Effects section starts empty (no default chain)");
}

const EFFECT_PARAM_LABELS = {
  filter: [
    "Filter type",
    "Cutoff (Hz)",
    "Resonance (Q)",
    "Gain (dB, shelf/peaking only)",
    "Wet",
  ],
  distortion: ["Amount", "Output gain", "Wet"],
  delay: ["Time (ms)", "Feedback", "Wet"],
  compressor: [
    "Threshold (dB)",
    "Knee (dB)",
    "Ratio",
    "Attack (ms)",
    "Release (ms)",
    "Wet",
  ],
  tremolo: ["Rate (Hz)", "Depth", "LFO shape", "Wet"],
  ringMod: ["Frequency (Hz)", "Carrier shape", "Wet"],
};
const EFFECT_TYPE_LABELS = {
  filter: "Filter",
  distortion: "Distortion",
  delay: "Delay",
  compressor: "Compressor",
  tremolo: "Tremolo",
  ringMod: "Ring Mod",
};

for (const [type, typeLabel] of Object.entries(EFFECT_TYPE_LABELS)) {
  await addEffect(rowPanel, type);
  await page.waitForTimeout(50);
  if ((await removeEffectButton(rowPanel, typeLabel).count()) === 0) {
    fail(`adding "${typeLabel}" did not add a removable instance`);
  }
  const panelText = await rowPanel.innerText();
  for (const label of EFFECT_PARAM_LABELS[type]) {
    if (!panelText.includes(label)) {
      fail(`row panel missing "${label}" after adding ${typeLabel}`);
    }
  }
}
ok(
  "adding each of the 6 effect types shows that instance's own full param list",
);

if ((await saveChainPresetButton(rowPanel).count()) === 0) {
  fail('"Save chain as preset…" should appear once the chain is non-empty');
} else {
  ok('"Save chain as preset…" appears once a chain has at least one effect');
}

// Multiple instances of the same type: add a second Delay, confirm two
// independent, independently-removable entries, then remove one and
// confirm exactly one remains.
await addEffect(rowPanel, "delay");
await page.waitForTimeout(50);
if ((await removeEffectButton(rowPanel, "Delay").count()) !== 2) {
  fail(
    `expected 2 Delay instances after adding a duplicate, got ${await removeEffectButton(rowPanel, "Delay").count()}`,
  );
} else {
  ok("adding the same effect type twice produces two independent instances");
}
await removeEffectButton(rowPanel, "Delay").first().click();
await page.waitForTimeout(50);
if ((await removeEffectButton(rowPanel, "Delay").count()) !== 1) {
  fail("removing one Delay instance should leave exactly one, not zero or two");
} else {
  ok(
    "removing one instance of a duplicated effect type leaves the other untouched",
  );
}

// Tremolo/Ring Mod LFO shape widened from sine/square(/sawtooth) to every
// OscillatorType short of "custom" -- see bruit-kit's TremoloWaveform/
// RingModulationWaveform. Both are already on the row from the loop above.
const tremoloShapeOptions = await effectParam(rowPanel, "LFO shape")
  .locator("select option")
  .allTextContents();
const ringModShapeOptions = await effectParam(rowPanel, "Carrier shape")
  .locator("select option")
  .allTextContents();
if (
  !["sine", "square", "sawtooth", "triangle"].every((w) =>
    tremoloShapeOptions.includes(w),
  ) ||
  !["sine", "square", "sawtooth", "triangle"].every((w) =>
    ringModShapeOptions.includes(w),
  )
) {
  fail(
    `Tremolo/Ring Mod waveform options should include sine/square/sawtooth/triangle, got ${tremoloShapeOptions} / ${ringModShapeOptions}`,
  );
} else {
  ok("Tremolo and Ring Mod expose every non-custom oscillator waveform");
}

// Save this 6-effect chain as a library preset -- applied to a different
// row later, via the main-page Effect Library panel.
page.once("dialog", (dialog) => dialog.accept("Verify Chain"));
await saveChainPresetButton(rowPanel).click();
await page.waitForTimeout(400);

// FmSynth (Bass) and GranularSynth (Pad) previously only exposed a couple
// of headline params each -- confirm every param bruit-kit's own classes
// support is now wired up (see sourceFactory.ts's PARAM_FIELDS_BY_SOURCE_TYPE).
await page
  .locator(".row-master", { hasText: "Bass" })
  .click({ button: "right" });
await page.waitForTimeout(50);
for (const label of ["Carrier waveform", "Modulator waveform"]) {
  if ((await page.locator(".panel-field", { hasText: label }).count()) === 0) {
    fail(`FmSynth row panel missing "${label}"`);
  }
}
ok("FmSynth row panel exposes carrier/modulator waveform");

await page
  .locator(".row-master", { hasText: "Pad" })
  .click({ button: "right" });
await page.waitForTimeout(50);
for (const label of [
  "Grain duration min",
  "Grain duration max",
  "Grain duration mode",
  "Position jitter",
  "Pan spread",
  "Scan speed",
  "Playhead mode",
  "Direct-play pitch",
]) {
  if ((await page.locator(".panel-field", { hasText: label }).count()) === 0) {
    fail(`GranularSynth row panel missing "${label}"`);
  }
}
ok(
  "GranularSynth row panel exposes every grain param, not just density/pitch jitter",
);

await page
  .locator(".row-master", { hasText: "Kicker" })
  .click({ button: "right" });
await page.waitForTimeout(50);

// Filter was added to Kicker back in the "add each of the 6 types" loop
// above -- reused here rather than adding a fresh one.
const filterCutoffInput = effectParam(rowPanel, "Cutoff (Hz)").locator(
  "input[type=range]",
);
const filterTypeSelect = effectParam(rowPanel, "Filter type").locator("select");

// Regression: dragging an effect param's value, with no render() call in
// the caller wrapping onUpdate, used to leave the change invisible on the
// next real render -- effectsFields' own onChange calls onUpdate
// synchronously and getEffects() is read fresh inside every handler
// specifically to avoid a stale-closure revert, but a caller that forgot
// its own render() call would still silently drop the change. Reselecting
// away and back forces a render from live model state, exposing either
// bug if it's back.
await filterTypeSelect.selectOption("highpass");
await filterCutoffInput.evaluate((el) => {
  el.value = "3500";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(50);
await page
  .locator(".row-master", { hasText: "Synth" })
  .click({ button: "right" });
await page.waitForTimeout(50);
await page
  .locator(".row-master", { hasText: "Kicker" })
  .click({ button: "right" });
await page.waitForTimeout(50);
if ((await removeEffectButton(rowPanel, "Filter").count()) === 0) {
  fail("Filter instance vanished after a reselect (stale-closure regression)");
}
if (
  (await effectParam(rowPanel, "Cutoff (Hz)")
    .locator("input[type=range]")
    .inputValue()) !== "3500"
) {
  fail("effect param value did not persist after drag + reselect");
}
if (
  (await effectParam(rowPanel, "Filter type")
    .locator("select")
    .inputValue()) !== "highpass"
) {
  fail("effect select-kind param value did not persist after drag + reselect");
} else {
  ok("effect instances and param values survive a drag across a reselect");
}

// Regression: Delay used to silence the row entirely, even the dry
// signal -- effectsChain.ts forced every effect fully wet, and a
// DelayNode emits nothing until its delay time has elapsed, so a short
// percussive hit never got heard at all. This can't assert on audio
// samples from here, but it does confirm the row keeps firing (playhead
// still advances) with a full 6-effect chain -- including Delay --
// active, and nothing throws.
await page.click("#play-button");
await page.waitForTimeout(600);
const playheadWithEffects = await page.evaluate(
  () => document.querySelectorAll(".cell.playhead").length,
);
await page.click("#stop-button");
if (playheadWithEffects === 0) {
  fail(
    "playhead stopped advancing with a full effects chain (incl. Delay) active",
  );
} else if (errors.length > 0) {
  fail(`errors with a full effects chain active:\n${errors.join("\n")}`);
} else {
  ok(
    "a full multi-effect chain including Delay doesn't break playback or throw",
  );
}

// Effect Library panel (main page, third stacked panel): applying a
// saved chain preset appends its whole ordered list of effects onto
// whatever's currently selected -- additive, not a replace -- and works
// on a row with no source-type gating at all, unlike instrument presets.
await page
  .locator(".row-master", { hasText: "Synth" })
  .click({ button: "right" });
await page.waitForTimeout(50);
if ((await removeEffectButton(rowPanel, "Filter").count()) !== 0) {
  fail(
    "Synth row should start with no effects of its own before applying a preset",
  );
}
await expandGroup("#effect-library", "Effect Chains");
await page
  .locator("#effect-library .library-tree-item button", {
    hasText: "Verify Chain",
  })
  .click();
await page.waitForTimeout(300);
if ((await removeEffectButton(rowPanel, "Delay").count()) === 0) {
  fail(
    "applying a saved effect chain preset should append its effects onto the selected row",
  );
} else {
  ok(
    "applying an Effect Library preset appends the whole saved chain onto a different row",
  );
}

// Global key/scale: a quantization constraint above the note cascade
// (see scale.ts's quantizeToScale, applied in gridModel.ts's fireTick) --
// note fields in the panel are never touched by it (silent snap, not a
// picker), and playback should keep working with a non-chromatic scale
// active.
const keySelect = page.locator("#key-select");
const scaleSelect = page.locator("#scale-select");
if ((await scaleSelect.inputValue()) !== "chromatic") {
  fail(
    `scale should default to chromatic (off), got "${await scaleSelect.inputValue()}"`,
  );
}
const bassDefaultNote = page
  .locator(".panel-field", { hasText: "Default note" })
  .locator("input[type=number]");
// Still on Synth from the Effect Library test above -- switch to Bass,
// whose Default note (36) isn't already in C major, to make a real snap
// possible if this leaked into the displayed value.
await page
  .locator(".row-master", { hasText: "Bass" })
  .click({ button: "right" });
await page.waitForTimeout(50);
const bassNoteBefore = await bassDefaultNote.inputValue();
await keySelect.selectOption("2"); // D
await scaleSelect.selectOption("major");
await page.waitForTimeout(50);
if ((await bassDefaultNote.inputValue()) !== bassNoteBefore) {
  fail(
    "changing the global scale should never rewrite a note field's raw value",
  );
} else {
  ok("scale change doesn't touch note fields' displayed (raw) values");
}
await page.click("#play-button");
await page.waitForTimeout(600);
const playheadWithScale = await page.evaluate(
  () => document.querySelectorAll(".cell.playhead").length,
);
await page.click("#stop-button");
if (playheadWithScale === 0) {
  fail("playhead stopped advancing with a non-chromatic scale active");
} else if (errors.length > 0) {
  fail(`errors after enabling a scale:\n${errors.join("\n")}`);
} else {
  ok("a non-chromatic key/scale doesn't break playback or throw");
}

// Cell panel: an Envelope section (every source type) plus, for sample
// rows only, an Effects section -- each with its own header toggle
// button, effects controls always visible and interactive (just visually
// dimmed) while its override is off.
await firstCell.click({ button: "right" });
await page.waitForTimeout(50);
const cellSectionTitles = await page
  .locator(".panel-section-title")
  .allTextContents();
if (!cellSectionTitles.includes("Envelope")) {
  fail("cell panel should have an Envelope section");
}
if (!cellSectionTitles.includes("Effects")) {
  fail("a sample row's cell panel should have an Effects section");
} else {
  ok("cell panel has Envelope and Effects sections");
}

const cellEffects = section(page, "Effects");
if (
  await cellEffects.button.evaluate((el) => el.classList.contains("active"))
) {
  fail("cell Effects override button should start inactive");
}
if (
  !(await cellEffects.body.evaluate((el) => el.classList.contains("dimmed")))
) {
  fail("cell Effects section should start dimmed (override off)");
}
if ((await cellEffects.removeEffectButton("Filter").count()) !== 0) {
  fail("cell Effects section should start with no default effects chain");
}
// Dimming (override off) is purely visual -- confirm the Add-effect
// control, and then a freshly-added instance's own params, stay
// interactive throughout.
if (await effectAddSelect(cellEffects.root).isDisabled()) {
  fail(
    "dimmed cell Effects section's Add-effect select should stay interactive, not disabled",
  );
}
await cellEffects.addEffect("filter");
await page.waitForTimeout(50);
const cellFilterCutoffInput = cellEffects
  .effectParam("Cutoff (Hz)")
  .locator("input[type=range]");
if (await cellFilterCutoffInput.isDisabled()) {
  fail("dimmed cell effects controls should stay interactive, not disabled");
} else {
  ok(
    "cell Effects section starts empty and dimmed, but its controls stay interactive",
  );
}
await cellFilterCutoffInput.evaluate((el) => {
  el.value = "2200";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(50);
await cellEffects.button.click();
await page.waitForTimeout(50);

const cellEffectsAfter = section(page, "Effects");
if (
  !(await cellEffectsAfter.button.evaluate((el) =>
    el.classList.contains("active"),
  ))
) {
  fail("cell Effects override button did not activate");
}
if (
  await cellEffectsAfter.body.evaluate((el) => el.classList.contains("dimmed"))
) {
  fail(
    "cell Effects section should no longer be dimmed once override is active",
  );
}
if ((await cellEffectsAfter.removeEffectButton("Filter").count()) === 0) {
  fail("cell effect added while dimmed did not survive activating override");
}
const cellFilterCutoffAfter = await cellEffectsAfter
  .effectParam("Cutoff (Hz)")
  .locator("input[type=range]")
  .inputValue();
if (cellFilterCutoffAfter !== "2200") {
  fail(
    `cell effect value set while dimmed did not persist: expected 2200, got ${cellFilterCutoffAfter}`,
  );
} else {
  ok("cell effects configured while dimmed persist once override is activated");
}
if (!(await firstCell.evaluate((el) => el.classList.contains("overridden")))) {
  fail(
    "cell should show the overridden indicator once its effects override is active",
  );
} else {
  ok("cell shows overridden indicator once its effects override is active");
}

// Cell Envelope: same consolidated-toggle pattern, no precedence-disable
// (a cell always wins unconditionally, so there's no "moot" case).
const cellEnvelope = section(page, "Envelope");
if (await cellEnvelope.button.isDisabled()) {
  fail("cell Envelope button should never be precedence-disabled");
}
await cellEnvelope.button.click();
await page.waitForTimeout(50);
if (
  !(await cellEnvelope.button.evaluate((el) => el.classList.contains("active")))
) {
  fail("cell Envelope override button did not activate");
} else {
  ok("cell Envelope override toggles on with no precedence-disable");
}

// Select a column -- override fields here too.
await page.locator(".column-master").first().click({ button: "right" });
await page.waitForTimeout(50);
if ((await page.locator(".panel-title").textContent()) !== "Column 1") {
  fail("column panel title should read exactly 'Column 1'");
} else {
  ok("column panel title identifies the column");
}
if (
  !(await page
    .locator(".column-master")
    .first()
    .evaluate((el) => el.classList.contains("selected")))
) {
  fail("selecting a column did not mark it .selected in the grid");
} else {
  ok("selecting a column marks it in the grid");
}

// Column header left-click still toggles skip-this-step-for-every-row,
// independent of selection.
const firstColumn = page.locator(".column-master").first();
const columnBefore = (await firstColumn.getAttribute("class")) ?? "";
await firstColumn.click();
const columnAfter = (await firstColumn.getAttribute("class")) ?? "";
if (columnBefore.includes("off") === columnAfter.includes("off")) {
  fail("clicking a column header did not toggle its enabled state");
} else {
  ok("column header toggles enabled/skip");
}
await firstColumn.click(); // restore

// Select master -- gain, effects chain, and limiter controls.
await page.click("#master-button");
await page.waitForTimeout(50);
if ((await page.locator(".panel-title").textContent()) !== "Master") {
  fail("master panel title should read exactly 'Master'");
}
const masterPanel = page.locator(".selection-panel");
const masterText = await masterPanel.innerText();
for (const label of [
  "Gain",
  "Add effect…", // master's Effects fields, spread in directly -- no default chain
  "Limiter ceiling",
  "Limiter release",
  "Reverb decay",
  "Reverb pre-delay",
  "Reverb damping",
]) {
  if (!masterText.includes(label)) fail(`master panel missing "${label}"`);
}
ok("master panel has gain/effects/limiter/reverb controls");

// Master's own effects chain behaves identically to a row's: no default
// chain, add/remove works the same way.
if ((await removeEffectButton(masterPanel, "Filter").count()) !== 0) {
  fail("master panel should start with no default effects chain");
}
await addEffect(masterPanel, "filter");
await page.waitForTimeout(50);
if ((await removeEffectButton(masterPanel, "Filter").count()) === 0) {
  fail("adding an effect to the master panel did not add a removable instance");
} else {
  ok(
    "master panel's Effects fields support the same add/remove chain as a row's",
  );
}

// The shared reverb bus's own decay/pre-delay/damping used to be
// hardcoded at construction with no UI at all -- confirm they're both
// live-adjustable and actually persist through a patch save/reload,
// same as every other master-level setting already does.
const reverbDecayInput = page
  .locator(".panel-field", { hasText: "Reverb decay" })
  .locator("input[type=range]");
await reverbDecayInput.evaluate((el) => {
  el.value = "5.5";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(50);

// Precedence, tempo, and step count controls.
await page.selectOption("#precedence-select", "column");
await page.selectOption("#precedence-select", "row");
ok("precedence dropdown selectable");

await page.fill("#bpm", "160");
await page.selectOption("#subdivision", "2"); // 1/8 notes
ok("BPM/subdivision tempo controls accept input");

await page.fill("#column-count", "12");
await page.dispatchEvent("#column-count", "change");
await page.waitForTimeout(100);
const resizedColumnCount = await page.locator(".column-master").count();
if (resizedColumnCount !== 12) {
  fail(`expected 12 columns after resize, found ${resizedColumnCount}`);
} else {
  ok("step count resizes the grid");
}

// Add one row of each source type (granularSynth exercises the async
// worklet init + fetched processor script; the others are synchronous).
for (const sourceType of ["granularSynth", "noiseGenerator", "fmSynth"]) {
  const beforeCount = await page.locator(".row-master").count();
  await page.selectOption("#new-row-type", sourceType);
  await page.click("#add-row-button");
  await page.waitForTimeout(400);
  const afterCount = await page.locator(".row-master").count();
  if (afterCount !== beforeCount + 1) {
    fail(`adding a ${sourceType} row did not increase row count`);
  } else {
    ok(`added a ${sourceType} row`);
  }
}

// Patch persistence: save the current (heavily-mutated -- 8 rows [demo's
// own 5 plus the 3 just added above], 12 columns, row precedence, 160
// BPM) state under a fixed name -- re-runs
// overwrite it via the same confirm() flow real usage goes through,
// rather than accumulating a fresh patch on every `make verify`. Reload
// (a genuinely fresh JS/module context) to prove "demo" loads by default
// and is unaffected by any of this run's mutations, then explicitly load
// the saved patch back and confirm the mutated state actually round-
// tripped through the backend.
const TEST_PATCH_NAME = "verify-test-patch";
await page.fill("#patch-name", TEST_PATCH_NAME);
// This confirm() is conditional (only fires on a name conflict, i.e. every
// run after the first) -- page.once() that never gets consumed would stay
// armed and steal the *next* dialog anywhere later in the run, so it's
// explicitly torn down instead of just left to fire-or-not.
const acceptSaveConflict = (dialog) => dialog.accept();
page.once("dialog", acceptSaveConflict);
await page.click("#save-patch-button");
await page.waitForTimeout(300);
page.off("dialog", acceptSaveConflict);
if ((await page.locator("#patch-status").textContent()) !== "Saved") {
  fail("saving a patch did not report success");
} else {
  ok("patch saves under a name, overwriting a prior same-named run");
}
// On every run after the first, this name already exists -- savePatch's
// own 409-then-overwrite-confirm flow (see main.ts) handles that
// correctly, but the browser also independently logs the underlying
// non-2xx fetch response to the console regardless of the app catching
// it, same as any failed request would. Expected noise from a
// deliberately-triggered conflict, not a real error.
const conflictNoiseIndex = errors.findIndex((e) =>
  e.includes("409 (Conflict)"),
);
if (conflictNoiseIndex !== -1) errors.splice(conflictNoiseIndex, 1);

await page.reload({ waitUntil: "networkidle" });
await page.click("#unlock button");
await page.waitForSelector("#app:not(.hidden)");
await page.waitForSelector(".row-master");
if ((await page.locator("#patch-name").inputValue()) !== "demo") {
  fail('a fresh reload should load "demo" by default');
}
if ((await page.locator(".row-master").count()) !== 5) {
  fail("demo should be unaffected by this run's mutations (still 5 rows)");
} else {
  ok('fresh reload loads "demo" by default, unaffected by prior mutations');
}
if (
  (await page.locator("#key-select").inputValue()) !== "0" ||
  (await page.locator("#scale-select").inputValue()) !== "chromatic"
) {
  fail(
    "demo should load with the default Chromatic/C scale, unaffected by this run's D major change",
  );
} else {
  ok("fresh reload's demo resets key/scale to the default (Chromatic/C)");
}
await page.click("#master-button");
await page.waitForTimeout(50);
const demoReverbDecay = await page
  .locator(".panel-field", { hasText: "Reverb decay" })
  .locator("input[type=range]")
  .inputValue();
if (demoReverbDecay !== "2.2") {
  fail(
    `demo should load with the default 2.2s reverb decay, unaffected by this run's 5.5s change, got ${demoReverbDecay}`,
  );
} else {
  ok("fresh reload's demo resets reverb decay to the default (2.2s)");
}

const patchOptionValue = await page
  .locator("#patch-select option", { hasText: TEST_PATCH_NAME })
  .getAttribute("value");
if (!patchOptionValue) {
  fail(`"${TEST_PATCH_NAME}" missing from the patch list after reload`);
} else {
  await page.selectOption("#patch-select", patchOptionValue);
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#load-patch-button");
  await page.waitForTimeout(500);
  const loadedRowCount = await page.locator(".row-master").count();
  const loadedColumnCount = await page.locator(".column-master").count();
  if (loadedRowCount !== 8 || loadedColumnCount !== 12) {
    fail(
      `loaded patch state mismatch: expected 8 rows/12 columns, got ${loadedRowCount} rows/${loadedColumnCount} columns`,
    );
  } else {
    ok("saved patch round-trips through the backend across a fresh reload");
  }
  if (
    (await page.locator("#key-select").inputValue()) !== "2" ||
    (await page.locator("#scale-select").inputValue()) !== "major"
  ) {
    fail("loaded patch should restore the D major key/scale it was saved with");
  } else {
    ok("saved patch round-trips its key/scale through the backend");
  }
  await page.click("#master-button");
  await page.waitForTimeout(50);
  const loadedReverbDecay = await page
    .locator(".panel-field", { hasText: "Reverb decay" })
    .locator("input[type=range]")
    .inputValue();
  if (loadedReverbDecay !== "5.5") {
    fail(
      `loaded patch should restore the 5.5s reverb decay it was saved with, got ${loadedReverbDecay}`,
    );
  } else {
    ok("saved patch round-trips its reverb decay through the backend");
  }
  await page
    .locator(".row-master", { hasText: "Kicker" })
    .click({ button: "right" });
  await page.waitForTimeout(50);
  if (
    !(await page
      .locator(".panel-field", { hasText: "Reverse playback" })
      .locator("input[type=checkbox]")
      .isChecked())
  ) {
    fail("loaded patch should restore Kicker's Reverse playback setting");
  } else {
    ok(
      "saved patch round-trips a row's Reverse playback setting through the backend",
    );
  }
}

// Library management page: full CRUD for samples and instrument presets,
// toggled in-app (no route change) via "Manage Library" -- the only place
// a brand-new local sample file can be added now (see main.ts's
// addSampleButtonEl handler).
await page.click("#manage-library-button");
await page.waitForTimeout(200);
if (
  !(await page
    .locator("#sequencer-view")
    .evaluate((el) => el.classList.contains("hidden"))) ||
  (await page
    .locator("#library-management-view")
    .evaluate((el) => el.classList.contains("hidden")))
) {
  fail("Manage Library button should swap to the management view");
} else {
  ok("Manage Library button toggles to the management page");
}

const managementWavPath = await writeTinyWavFixture();
const [managementFileChooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.click("#add-sample-button"),
]);
page.once("dialog", (dialog) => dialog.accept("Verify Upload"));
await managementFileChooser.setFiles(managementWavPath);
await page.waitForTimeout(600);

await expandGroup("#sample-management", "other");
const uploadedRow = page.locator("#sample-management .management-row", {
  hasText: "Verify Upload",
});
if ((await uploadedRow.count()) === 0) {
  fail("newly-added local sample should appear in the management page");
} else {
  ok('management page\'s "+ Add sample" is now the only local-upload path');
}

// Rename it.
page.once("dialog", (dialog) => dialog.accept("Verify Upload Renamed"));
await uploadedRow.locator("button", { hasText: "Rename" }).click();
await page.waitForTimeout(300);
const renamedRow = page.locator("#sample-management .management-row", {
  hasText: "Verify Upload Renamed",
});
if ((await renamedRow.count()) === 0) {
  fail("renaming a sample in the management page did not take effect");
} else {
  ok("management page renames a sample");
}

// Re-categorize it, then confirm it moved groups (the tree stays expanded
// across the rebuild -- see libraryTree.ts's openLabels handling).
await renamedRow.locator("select").selectOption("fx");
await page.waitForTimeout(300);
await expandGroup("#sample-management", "fx");
if (
  (await page
    .locator("#sample-management .management-row", {
      hasText: "Verify Upload Renamed",
    })
    .count()) === 0
) {
  fail("re-categorizing a sample in the management page did not move it");
} else {
  ok("management page re-categorizes a sample");
}

// Permanent, destructive reverse (backend/src/sampleStore.ts's
// reverseSampleAudio, reversing the WAV file's own PCM data in place) --
// distinct from a row's own non-destructive "Reverse playback" checkbox
// tested earlier. Still in the "fx" group from the re-categorize step.
const fxRow = page.locator("#sample-management .management-row", {
  hasText: "Verify Upload Renamed",
});
page.once("dialog", (dialog) => dialog.accept());
await fxRow.locator("button", { hasText: "Reverse" }).click();
await page.waitForTimeout(300);
if (
  (await page
    .locator("#sample-management .management-row", {
      hasText: "Verify Upload Renamed",
    })
    .count()) === 0
) {
  fail(
    "permanently reversing a sample in the management page removed it from the list",
  );
} else if (errors.length > 0) {
  fail(`errors after permanently reversing a sample:\n${errors.join("\n")}`);
} else {
  ok("management page permanently reverses a sample's stored audio");
}

// Delete it.
page.once("dialog", (dialog) => dialog.accept());
await page
  .locator("#sample-management .management-row", {
    hasText: "Verify Upload Renamed",
  })
  .locator("button", { hasText: "Delete" })
  .click();
await page.waitForTimeout(300);
if (
  (await page
    .locator("#sample-management", { hasText: "Verify Upload Renamed" })
    .count()) !== 0
) {
  fail("deleting a sample in the management page did not remove it");
} else {
  ok("management page deletes a sample");
}

// Instrument preset editing: expand "Verify Preset" (saved earlier from
// the Synth row), change a param, save, and confirm it persisted.
await expandGroup("#instrument-preset-management", "Oscillator");
const presetManagementRow = page.locator(
  "#instrument-preset-management .library-tree-item",
  { hasText: "Verify Preset" },
);
await presetManagementRow.locator("button", { hasText: "Edit" }).click();
await page.waitForTimeout(200);
const detuneInput = presetManagementRow
  .locator(".panel-field", { hasText: "Detune" })
  .locator("input[type=range]");
await detuneInput.evaluate((el) => {
  el.value = "42";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await presetManagementRow
  .locator("button", { hasText: "Save changes" })
  .click();
await page.waitForTimeout(400);
const presetManagementRowAfter = page.locator(
  "#instrument-preset-management .library-tree-item",
  { hasText: "Verify Preset" },
);
await presetManagementRowAfter.locator("button", { hasText: "Edit" }).click();
await page.waitForTimeout(200);
const detuneAfterSave = await presetManagementRowAfter
  .locator(".panel-field", { hasText: "Detune" })
  .locator("input[type=range]")
  .inputValue();
if (detuneAfterSave !== "42") {
  fail(
    `management page's preset edit should persist: expected detune 42, got ${detuneAfterSave}`,
  );
} else {
  ok("management page edits an instrument preset's own params and it persists");
}

// Delete it.
page.once("dialog", (dialog) => dialog.accept());
await presetManagementRowAfter.locator("button", { hasText: "Delete" }).click();
await page.waitForTimeout(300);
if (
  (await page
    .locator("#instrument-preset-management", { hasText: "Verify Preset" })
    .count()) !== 0
) {
  fail(
    "deleting an instrument preset in the management page did not remove it",
  );
} else {
  ok("management page deletes an instrument preset");
}

// Back to the sequencer.
await page.click("#manage-library-button");
await page.waitForTimeout(200);

// Play / stop.
await page.click("#play-button");
await page.waitForTimeout(800);
const playheadCount = await page.evaluate(
  () => document.querySelectorAll(".cell.playhead").length,
);
if (playheadCount === 0) fail("no playhead cells lit while playing");
else ok("playhead advances while playing");

// Record audio out: taps limiter.output (the exact node feeding
// audioContext.destination -- see main.ts) via bruit-kit's Recorder,
// re-encodes the captured clip as WAV, and triggers a real browser
// download -- confirm the file that lands is a genuine, non-empty WAV.
await page.click("#record-button");
await page.waitForTimeout(50);
if ((await page.locator("#record-status").textContent()) !== "Recording…") {
  fail('record button did not show "Recording…" status');
}
await page.waitForTimeout(1000);
const downloadPromise = page.waitForEvent("download");
await page.click("#record-button");
const download = await downloadPromise;
const downloadPath = await download.path();
const wavBytes = await readFile(downloadPath);
if (
  wavBytes.length < 100 ||
  wavBytes.toString("ascii", 0, 4) !== "RIFF" ||
  wavBytes.toString("ascii", 8, 12) !== "WAVE"
) {
  fail(`recorded download isn't a valid WAV file (${wavBytes.length} bytes)`);
} else {
  ok("recording downloads a genuine, non-empty WAV file");
}

await page.click("#stop-button");

await page.screenshot({
  path: path.join(__dirname, "screenshots/grid.png"),
});

if (errors.length > 0) {
  fail(`console/page errors during run:\n${errors.join("\n")}`);
} else {
  ok("no console errors");
}

await browser.close();
