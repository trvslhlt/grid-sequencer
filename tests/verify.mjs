// Manual (non-CI) golden-path browser check: unlock audio, toggle cells,
// select each panel kind (cell/row/column/master) and exercise its
// override fields and sections (Defaults/Envelope/Effects, including the
// precedence-aware disabled-but-shown-active state), drag an Envelope
// section's breakpoint-curve editor and confirm it persists, the
// explicitDuration trigger mode's steps-based duration field, the
// Compressor effect toggle, add one of each of the 5 source types
// (GranularSynth exercises its async worklet init), flip row/column
// precedence, tempo, and step count, and play -- all with zero console
// errors.
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

/** An "override" field is a checkbox + a value control together (see
 * fields.ts) -- this locator scoping matches both without depending on
 * DOM order. Used by cell-level note/gain/gate/time-shift fields. */
function overrideField(page, label) {
  const field = page.locator(".panel-field", { hasText: label });
  return {
    field,
    checkbox: field.locator(".override-control input[type=checkbox]"),
    input: field.locator(".override-control input[type=range]"),
  };
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
  };
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

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.click("#unlock button");
await page.waitForSelector("#app:not(.hidden)");

const rowCount = await page.locator(".row-master").count();
if (rowCount !== 2) fail(`expected 2 starter rows, found ${rowCount}`);
else ok("2 starter rows loaded");

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

// Row menu should show all four effect toggles, each already paired with
// its (disabled-until-checked) param control -- nothing conditionally
// appears/disappears as a side effect of *other* fields any more.
const menuText = await page.locator(".config-panel").innerText();
for (const label of ["Filter", "Distortion", "Delay", "Compressor"]) {
  if (!menuText.includes(label))
    fail(`row panel missing "${label}" effect toggle`);
}
ok("row panel shows all effect toggles without needing to reopen anything");

const filterOverride = overrideField(page, "Filter");
if (!(await filterOverride.input.isDisabled())) {
  fail("Filter's param control should start disabled");
}
await filterOverride.checkbox.click();
await page.waitForTimeout(50);
if (await filterOverride.input.isDisabled()) {
  fail("Filter's param control should enable immediately on check");
} else {
  ok("effect toggle enables its param control immediately, in place");
}

// Regression: toggling an effect on and then dragging its value, with no
// render in between, used to silently revert the toggle -- the value
// handler closed over the pre-toggle effects array. Reselecting away and
// back forces a render from live model state, exposing the bug if it's
// back.
await filterOverride.input.evaluate((el) => {
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
const filterOverrideAfter = overrideField(page, "Filter");
if (!(await filterOverrideAfter.checkbox.isChecked())) {
  fail("effect toggle+drag reverted the toggle (stale-closure regression)");
}
if ((await filterOverrideAfter.input.inputValue()) !== "3500") {
  fail(
    `effect value did not persist after toggle+drag: expected 3500, got ${await filterOverrideAfter.input.inputValue()}`,
  );
} else {
  ok("effect toggle survives a value drag with no render in between");
}

// Regression: enabling Delay used to silence the row entirely, even the
// dry signal -- effectsChain.ts forced every effect fully wet, and a
// DelayNode emits nothing until its delay time has elapsed, so a short
// percussive hit never got heard at all. This can't assert on audio
// samples from here, but it does confirm the row keeps firing (playhead
// still advances) and nothing throws with delay active.
const delayOverride = overrideField(page, "Delay");
await delayOverride.checkbox.click();
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
const cellFilterCheckbox = cellEffects
  .field("Filter")
  .locator("input[type=checkbox]");
const cellFilterInput = cellEffects
  .field("Filter")
  .locator("input[type=range]");
if (await cellFilterInput.isDisabled()) {
  fail("dimmed cell effects controls should stay interactive, not disabled");
} else {
  ok("cell Effects section starts dimmed but interactive");
}
await cellFilterCheckbox.click();
await page.waitForTimeout(50);
await cellFilterInput.evaluate((el) => {
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
const cellFilterCheckboxAfter = cellEffectsAfter
  .field("Filter")
  .locator("input[type=checkbox]");
const cellFilterInputAfter = cellEffectsAfter
  .field("Filter")
  .locator("input[type=range]");
if (!(await cellFilterCheckboxAfter.isChecked())) {
  fail(
    "cell effect checkbox set while dimmed did not survive activating override",
  );
}
if ((await cellFilterInputAfter.inputValue()) !== "2200") {
  fail(
    `cell effect value set while dimmed did not persist: expected 2200, got ${await cellFilterInputAfter.inputValue()}`,
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

// Play / stop.
await page.click("#play-button");
await page.waitForTimeout(800);
const playheadCount = await page.evaluate(
  () => document.querySelectorAll(".cell.playhead").length,
);
if (playheadCount === 0) fail("no playhead cells lit while playing");
else ok("playhead advances while playing");
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
