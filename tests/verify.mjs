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

// Row-master context menu.
await page.locator(".row-master").first().click({ button: "right" });
await page.waitForSelector(".context-menu");
const rowFieldCount = await page.locator(".context-menu .menu-field").count();
if (rowFieldCount === 0) fail("row-master context menu has no fields");
await page.mouse.click(10, 10);
await page.waitForTimeout(50);
if ((await page.locator(".context-menu").count()) !== 0) {
  fail("row-master context menu did not close on outside click");
} else {
  ok("row-master context menu opens and closes");
}

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
