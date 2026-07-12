// Manual (non-CI) golden-path browser check: unlock audio, toggle cells,
// select each panel kind (cell/row/column/master) and exercise its
// override fields, add one of each of the 5 source types (GranularSynth
// exercises its async worklet init), flip row/column precedence, tempo,
// and step count, and play -- all with zero console errors.
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
 * DOM order. */
function overrideField(page, label) {
  const field = page.locator(".panel-field", { hasText: label });
  return {
    field,
    checkbox: field.locator(".override-control input[type=checkbox]"),
    input: field.locator(".override-control input[type=range]"),
  };
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

// Select the "Kick" row -- exercise an override field end to end: starts
// unchecked/disabled showing the resolved (built-in) value, checking it
// enables the control, and the value survives switching selection away
// and back (this is the state-persistence class of bug fixed earlier --
// re-verified here against the new panel instead of the old popup).
await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForTimeout(50);
if ((await page.locator(".panel-title").textContent()) !== "Row: Kick") {
  fail("row panel title should read exactly 'Row: Kick'");
} else {
  ok("row panel title identifies the row");
}

const noteOverride = overrideField(page, "Default note");
if (await noteOverride.checkbox.isChecked()) {
  fail("a fresh row's Default note override should start unchecked");
}
if (!(await noteOverride.input.isDisabled())) {
  fail("Default note's value control should be disabled until overridden");
}
if ((await noteOverride.input.inputValue()) !== "60") {
  fail(
    `Default note should preview the built-in fallback (60) when not overridden, got ${await noteOverride.input.inputValue()}`,
  );
} else {
  ok("override field starts unchecked, disabled, showing the resolved value");
}

await noteOverride.checkbox.click();
await page.waitForTimeout(50);
if (await noteOverride.input.isDisabled()) {
  fail("Default note's value control should enable immediately on check");
} else {
  ok("checking an override enables its value control immediately");
}
await noteOverride.input.evaluate((el) => {
  el.value = "84";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(50);

await page
  .locator(".row-master", { hasText: "Synth" })
  .click({ button: "right" });
await page.waitForTimeout(50);
await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForTimeout(50);
const noteOverrideAgain = overrideField(page, "Default note");
if (!(await noteOverrideAgain.checkbox.isChecked())) {
  fail(
    "Default note override did not survive switching selection away and back",
  );
}
if ((await noteOverrideAgain.input.inputValue()) !== "84") {
  fail(
    `Default note value did not persist: expected 84, got ${await noteOverrideAgain.input.inputValue()}`,
  );
} else {
  ok("override value and checked state persist across reselection");
}

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

// Row menu should show all three effect toggles, each already paired with
// its (disabled-until-checked) param control -- nothing conditionally
// appears/disappears as a side effect of *other* fields any more.
const menuText = await page.locator(".config-panel").innerText();
for (const label of ["Filter", "Distortion", "Delay"]) {
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
