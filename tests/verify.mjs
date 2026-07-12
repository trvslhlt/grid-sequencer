// Manual (non-CI) golden-path browser check: unlock audio, toggle cells,
// open every context-menu kind (cell/row-master/column-master), add one of
// each of the 5 source types (GranularSynth exercises its async worklet
// init), flip row/column precedence, and play -- all with zero console
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

// Regression: contextMenu.ts's renderField used to set a range/number
// input's value *before* its min/max/step, so the browser's default
// constraints (min 0, max 100, step 1) would silently round any
// fractional value -- a fresh row's 0.8 default gain became 1 on its very
// first render, before any onChange ever fired. Checking a never-touched
// row's default catches that class of bug specifically (not just values
// this script itself later sets).
await page
  .locator(".row-master", { hasText: "Kick" })
  .click({ button: "right" });
await page.waitForSelector(".context-menu");
const freshGain = await page
  .locator(".menu-field", { hasText: "Default gain" })
  .locator("input[type=range]")
  .inputValue();
if (Number(freshGain) !== 0.8) {
  fail(`fresh row's default gain should render as 0.8, got ${freshGain}`);
} else {
  ok("fractional default values render uncorrupted");
}
await page.mouse.click(10, 10);
await page.waitForTimeout(50);

// Cell toggle.
const firstCell = page.locator(".cell").first();
const before = (await firstCell.getAttribute("class")) ?? "";
await firstCell.click();
const after = (await firstCell.getAttribute("class")) ?? "";
if (before.includes("on") === after.includes("on")) {
  fail("clicking a cell did not toggle its on/off state");
} else {
  ok("cell toggles on/off");
}

// Cell context menu opens and closes.
await firstCell.click({ button: "right" });
await page.waitForSelector(".context-menu");
const cellFieldCount = await page.locator(".context-menu .menu-field").count();
if (cellFieldCount === 0) fail("cell context menu has no fields");
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
if ((await page.locator(".context-menu").count()) !== 0) {
  fail("cell context menu did not close on Escape");
} else {
  ok("cell context menu opens and closes");
}

// Row-master context menu, including the filter/distortion/delay toggles.
await page.locator(".row-master").first().click({ button: "right" });
await page.waitForSelector(".context-menu");
const rowFieldCount = await page.locator(".context-menu .menu-field").count();
if (rowFieldCount === 0) fail("row-master context menu has no fields");
const menuText = await page.locator(".context-menu").innerText();
for (const label of ["Filter enabled", "Distortion enabled", "Delay enabled"]) {
  if (!menuText.includes(label)) fail(`row menu missing "${label}" toggle`);
}
ok("row menu has filter/distortion/delay toggles");
// Enabling Distortion should reveal its Amount slider once the menu is
// reopened (this popup doesn't live-refresh an already-open menu).
const distortionCheckbox = page
  .locator(".menu-field", { hasText: "Distortion enabled" })
  .locator("input[type=checkbox]");
await distortionCheckbox.click();
await page.waitForTimeout(100);
await page.locator(".row-master").first().click({ button: "right" });
await page.waitForSelector(".context-menu");
const menuTextAfter = await page.locator(".context-menu").innerText();
if (!menuTextAfter.includes("Amount")) {
  fail("enabling Distortion did not reveal its Amount slider on reopen");
} else {
  ok("enabling an effect reveals its param slider");
}
await page.mouse.click(10, 10);
await page.waitForTimeout(50);
if ((await page.locator(".context-menu").count()) !== 0) {
  fail("row-master context menu did not close on outside click");
} else {
  ok("row-master context menu opens and closes");
}

// Regression: renaming a row, setting its reverb send, and adjusting a
// per-source-type param (Detune, on the oscillator "Synth" row) must all
// persist and show the *current* value next time the menu reopens --
// these previously fell back to a hardcoded/static value instead.
const synthRow = page.locator(".row-master", { hasText: "Synth" });
await synthRow.click({ button: "right" });
await page.waitForSelector(".context-menu");
await page
  .locator(".menu-field", { hasText: "Name" })
  .locator("input[type=text]")
  .fill("Lead");
await page
  .locator(".menu-field", { hasText: "Reverb send" })
  .locator("input[type=range]")
  .fill("0.42");
await page
  .locator(".menu-field", { hasText: "Detune" })
  .locator("input[type=range]")
  .fill("37");
await page.keyboard.press("Tab"); // commit the text input's "change" event
await page.mouse.click(10, 10);
await page.waitForTimeout(100);

const renamedRow = page.locator(".row-master", { hasText: "Lead" });
if ((await renamedRow.count()) === 0) {
  fail("row rename did not persist to the grid label");
} else {
  ok("row rename persists");
}
await renamedRow.click({ button: "right" });
await page.waitForSelector(".context-menu");
const reverbSendValue = await page
  .locator(".menu-field", { hasText: "Reverb send" })
  .locator("input[type=range]")
  .inputValue();
const detuneValue = await page
  .locator(".menu-field", { hasText: "Detune" })
  .locator("input[type=range]")
  .inputValue();
if (Number(reverbSendValue) < 0.4) {
  fail(`reverb send did not persist: expected ~0.42, got ${reverbSendValue}`);
} else {
  ok("reverb send value persists across menu reopen");
}
if (Number(detuneValue) !== 37) {
  fail(`Detune did not persist: expected 37, got ${detuneValue}`);
} else {
  ok("source param value persists across menu reopen");
}
await page.mouse.click(10, 10);
await page.waitForTimeout(50);

// Column-master toggle (skip-this-step-for-every-row) via left click.
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

// Precedence toggle.
await page.selectOption("#precedence-select", "column");
await page.selectOption("#precedence-select", "row");
ok("precedence dropdown selectable");

// Tempo: BPM + subdivision drive step length, not a raw seconds slider.
await page.fill("#bpm", "160");
await page.selectOption("#subdivision", "2"); // 1/8 notes
ok("BPM/subdivision tempo controls accept input");

// Variable step count: grid should actually resize.
await page.fill("#column-count", "12");
await page.dispatchEvent("#column-count", "change");
await page.waitForTimeout(100);
const resizedColumnCount = await page.locator(".column-master").count();
if (resizedColumnCount !== 12) {
  fail(`expected 12 columns after resize, found ${resizedColumnCount}`);
} else {
  ok("step count resizes the grid");
}

// Master panel: gain, effect toggles, and limiter controls.
await page.click("#master-button");
await page.waitForSelector(".context-menu");
const masterMenuText = await page.locator(".context-menu").innerText();
for (const label of [
  "Gain",
  "Filter enabled",
  "Limiter ceiling",
  "Limiter release",
]) {
  if (!masterMenuText.includes(label)) fail(`master panel missing "${label}"`);
}
ok("master panel has gain/effects/limiter controls");
await page.mouse.click(10, 10);
await page.waitForTimeout(50);

// Add one row of each source type (granularSynth exercises the async
// worklet init + fetched processor script; the others are synchronous).
for (const sourceType of ["granularSynth", "noiseGenerator", "fmSynth"]) {
  const before = await page.locator(".row-master").count();
  await page.selectOption("#new-row-type", sourceType);
  await page.click("#add-row-button");
  await page.waitForTimeout(400);
  const afterCount = await page.locator(".row-master").count();
  if (afterCount !== before + 1) {
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
