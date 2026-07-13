// Manual (non-CI) golden-path browser check: unlock audio, toggle cells,
// select each panel kind (cell/row/column/master) and exercise its
// override fields and sections (Defaults/Envelope/Effects, including the
// precedence-aware disabled-but-shown-active state), drag an Envelope
// section's breakpoint-curve editor and confirm it persists, a sample
// row's playback range view (drag handles trim which portion of the
// buffer plays, also persisted), the explicitDuration trigger mode's
// steps-based duration field, all 6 effect types (filter/distortion/
// delay/compressor/tremolo/ringMod) and every one of each one's own
// params -- not just a single headline param each -- add one of each of
// the 5 source types (GranularSynth exercises its async worklet init),
// flip row/column precedence, tempo, and step count, patch persistence
// (save under a name, reload the page for a genuinely fresh context,
// confirm "demo" loads by default and the saved patch round-trips
// through the real backend), recording audio out to a real WAV download,
// and play -- all with zero console errors.
import { readFile } from "node:fs/promises";
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
    // An effect's own on/off checkbox (see effectToggle below), scoped to
    // this section.
    effectToggle(effectLabel) {
      return effectToggle(root, effectLabel);
    },
    // One of an effect's own params (see effectParam below), scoped to
    // this section.
    effectParam(paramLabel) {
      return effectParam(root, paramLabel);
    },
  };
}

/** effectsFields (see gridView.ts) renders one checkbox field per effect
 * type -- its label is exactly the effect's name, e.g. "Filter" -- followed
 * by that effect's own params as separate fields, unprefixed (just
 * "Cutoff (Hz)", not "Filter: Cutoff (Hz)": the checkbox row already
 * reads as that group's heading). `hasText` alone would also match a
 * param field whose label happens to *contain* the effect's name, so this
 * needs an *exact* label match to land on the checkbox row specifically. */
function effectToggle(scope, effectLabel) {
  return scope
    .locator(`.panel-field:has(label:text-is("${effectLabel}"))`)
    .locator("input[type=checkbox]");
}

/** One of an effect's own param fields, by its own (unprefixed) label --
 * a plain range or select field, always interactive regardless of the
 * effect's own checkbox state (see gridView.ts's effectsFields doc for
 * why that's a deliberate unification, not a bug). Every param label is
 * unique app-wide *except* "Wet", which every effect type has -- scope to
 * a specific effect's section, or pick a different param, when that
 * matters. */
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

const browser = await chromium.launch();
const page = await browser.newPage();

page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("requestfailed", (req) =>
  errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`),
);
// Save-overwrite and load-replace both confirm() -- always accept, an
// unhandled dialog would otherwise hang the run.
page.on("dialog", (dialog) => dialog.accept());

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.click("#unlock button");
await page.waitForSelector("#app:not(.hidden)");
// #app losing .hidden only means the audio-unlock step finished -- demo
// seeding/loading happens after that, via the backend (see main.ts), so
// the grid itself isn't populated yet until a row actually appears.
await page.waitForSelector(".row-master");

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
await firstCell.click({ button: "right" });
await page.waitForTimeout(50);
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

// Defaults/Envelope are consolidated single-toggle sections now (not
// per-field checkboxes) -- with the default global precedence ("Row
// wins"), the row's own Defaults/Envelope buttons should be disabled:
// row already wins whenever both set a value, so an explicit override
// here can't change anything. They should also show as *active* while
// disabled, not off -- the winning side always contributes its defaults
// unconditionally (see resolveCellConfig's doc), so a disabled-but-off
// button would misrepresent that as "not contributing."
const rowDefaults = section(page, "Defaults");
const rowEnvelope = section(page, "Envelope");
if (!(await rowDefaults.button.isDisabled())) {
  fail(
    "row Defaults button should be disabled while row already has precedence",
  );
}
if (!(await rowEnvelope.button.isDisabled())) {
  fail(
    "row Envelope button should be disabled while row already has precedence",
  );
}
if (
  !(await rowDefaults.button.evaluate((el) => el.classList.contains("active")))
) {
  fail(
    "row Defaults button should show active while precedence-disabled, not off",
  );
}
if (
  !(await rowEnvelope.button.evaluate((el) => el.classList.contains("active")))
) {
  fail(
    "row Envelope button should show active while precedence-disabled, not off",
  );
}
if (await rowDefaults.body.evaluate((el) => el.classList.contains("dimmed"))) {
  fail(
    "row Defaults section should not be dimmed while precedence-active (even though disabled)",
  );
} else {
  ok(
    "row Defaults/Envelope buttons disabled but shown active (row already has precedence)",
  );
}

// Column doesn't have precedence by default, so its Defaults/Envelope
// buttons should be enabled -- exercise the full toggle-on, set-value,
// persist-across-reselection path there instead.
await page.locator(".column-master").first().click({ button: "right" });
await page.waitForTimeout(50);
const columnDefaults = section(page, "Defaults");
const columnEnvelope = section(page, "Envelope");
if (await columnDefaults.button.isDisabled()) {
  fail(
    "column Defaults button should be enabled by default (row has precedence, not column)",
  );
}
await columnDefaults.button.click();
await page.waitForTimeout(50);
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

// Flip global precedence: the row's buttons should enable (row is now the
// losing side) and the column's should disable (column now wins).
await page.selectOption("#precedence-select", "column");
await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForTimeout(50);
if (await section(page, "Defaults").button.isDisabled()) {
  fail("row Defaults button should enable once column has precedence instead");
}
await page.locator(".column-master").first().click({ button: "right" });
await page.waitForTimeout(50);
if (!(await section(page, "Defaults").button.isDisabled())) {
  fail("column Defaults button should disable once column has precedence");
} else {
  ok(
    "Defaults/Envelope disabled state follows the global precedence setting live",
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

// Row menu should show all 6 effect types and *all* of each one's own
// params (not just a single headline param each) -- nothing conditionally
// appears/disappears as a side effect of *other* fields any more. Param
// labels are unprefixed (no "Filter: " before "Cutoff (Hz)") -- the
// checkbox row reads as that group's own heading -- so "Wet" only needs
// checking once even though every effect has one.
const menuText = await page.locator(".config-panel").innerText();
const expectedEffectLabels = [
  "Filter",
  "Filter type",
  "Cutoff (Hz)",
  "Resonance (Q)",
  "Wet",
  "Distortion",
  "Amount",
  "Output gain",
  "Delay",
  "Time (ms)",
  "Feedback",
  "Compressor",
  "Threshold (dB)",
  "Ratio",
  "Attack (ms)",
  "Release (ms)",
  "Tremolo",
  "Rate (Hz)",
  "Depth",
  "LFO shape",
  "Ring Mod",
  "Frequency (Hz)",
  "Carrier shape",
];
for (const label of expectedEffectLabels) {
  if (!menuText.includes(label))
    fail(`row panel missing "${label}" effect control`);
}
ok("row panel shows every effect type and all of each one's own params");

const filterToggle = effectToggle(page, "Filter");
const filterCutoff = effectParam(page, "Cutoff (Hz)");
const filterCutoffInput = filterCutoff.locator("input[type=range]");
if (await filterCutoffInput.isDisabled()) {
  fail("Filter's param controls should always be interactive, checkbox or not");
} else {
  ok("effect param controls are interactive before their checkbox is on");
}
await filterToggle.click();
await page.waitForTimeout(50);

// Regression: toggling an effect on and then dragging one of its values,
// with no render in between, used to silently revert the toggle -- the
// value handler closed over the pre-toggle effects array. Reselecting
// away and back forces a render from live model state, exposing the bug
// if it's back.
const filterTypeSelect = effectParam(page, "Filter type").locator("select");
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
if (!(await effectToggle(page, "Filter").isChecked())) {
  fail("effect toggle+drag reverted the toggle (stale-closure regression)");
}
if (
  (await effectParam(page, "Cutoff (Hz)")
    .locator("input[type=range]")
    .inputValue()) !== "3500"
) {
  fail("effect param value did not persist after toggle+drag");
}
if (
  (await effectParam(page, "Filter type").locator("select").inputValue()) !==
  "highpass"
) {
  fail("effect select-kind param value did not persist after toggle+drag");
} else {
  ok("effect toggle and param values survive a drag with no render in between");
}

// Regression: enabling Delay used to silence the row entirely, even the
// dry signal -- effectsChain.ts forced every effect fully wet, and a
// DelayNode emits nothing until its delay time has elapsed, so a short
// percussive hit never got heard at all. This can't assert on audio
// samples from here, but it does confirm the row keeps firing (playhead
// still advances) and nothing throws with delay active.
await effectToggle(page, "Delay").click();
await page.waitForTimeout(50);
await page.click("#play-button");
await page.waitForTimeout(600);
const playheadWithDelay = await page.evaluate(
  () => document.querySelectorAll(".cell.playhead").length,
);
await page.click("#stop-button");
if (playheadWithDelay === 0) {
  fail("playhead stopped advancing with Delay enabled");
} else if (errors.length > 0) {
  fail(`errors after enabling Delay:\n${errors.join("\n")}`);
} else {
  ok("enabling Delay doesn't break playback or throw");
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
const cellFilterCutoffInput = cellEffects
  .effectParam("Cutoff (Hz)")
  .locator("input[type=range]");
if (await cellFilterCutoffInput.isDisabled()) {
  fail("dimmed cell effects controls should stay interactive, not disabled");
} else {
  ok("cell Effects section starts dimmed but interactive");
}
await cellEffects.effectToggle("Filter").click();
await page.waitForTimeout(50);
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
if (!(await cellEffectsAfter.effectToggle("Filter").isChecked())) {
  fail(
    "cell effect checkbox set while dimmed did not survive activating override",
  );
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

// Select master -- gain, effect toggles, and limiter controls.
await page.click("#master-button");
await page.waitForTimeout(50);
if ((await page.locator(".panel-title").textContent()) !== "Master") {
  fail("master panel title should read exactly 'Master'");
}
const masterText = await page.locator(".config-panel").innerText();
for (const label of ["Gain", "Filter", "Limiter ceiling", "Limiter release"]) {
  if (!masterText.includes(label)) fail(`master panel missing "${label}"`);
}
ok("master panel has gain/effects/limiter controls");

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
await page.click("#save-patch-button");
await page.waitForTimeout(300);
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

const patchOptionValue = await page
  .locator("#patch-select option", { hasText: TEST_PATCH_NAME })
  .getAttribute("value");
if (!patchOptionValue) {
  fail(`"${TEST_PATCH_NAME}" missing from the patch list after reload`);
} else {
  await page.selectOption("#patch-select", patchOptionValue);
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
}

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
