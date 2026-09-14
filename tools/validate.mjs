/*
 * Pre-deploy validation.
 *
 * Catches the class of mistake that a web edit makes easy and that only shows
 * up once the site is live: a trailing comma in a JSON file, a stray comma in
 * config.js, an item id in itemSubset that does not exist.
 *
 * Run by .github/workflows/deploy.yml before anything is published, so a bad
 * commit fails the build instead of taking the instrument down. Locally:
 *
 *     node tools/validate.mjs
 *
 * Exit code 0 = safe to deploy. Anything else = do not publish.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

function fail(where, message) {
  problems.push(`${where}: ${message}`);
}

/* -------------------------------------------------------------------------
 * JSON syntax — the fault that took the live build down on 2026-09-14
 * ---------------------------------------------------------------------- */

async function readJSON(relative) {
  const text = await readFile(join(root, relative), "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    // JSON.parse reports a character offset; turn it into a line and column,
    // because "position 719" is not something you can act on in an editor.
    const offset = Number(/position (\d+)/.exec(error.message)?.[1] ?? -1);
    let place = "";
    if (offset >= 0) {
      const before = text.slice(0, offset);
      const line = before.split("\n").length;
      const column = offset - before.lastIndexOf("\n");
      place = ` (line ${line}, column ${column})`;
    }
    fail(relative, `not valid JSON${place} — ${error.message}`);
    return null;
  }
}

/* -------------------------------------------------------------------------
 * Content rules — the same ones app.js enforces at startup, applied early
 * ---------------------------------------------------------------------- */

function checkItems(items) {
  if (!items) return null;
  if (!Array.isArray(items.items)) {
    fail("content/items.json", 'expected an object with an "items" array');
    return null;
  }
  if (items.items.length === 0) fail("content/items.json", "the items array is empty");

  const seen = new Set();
  items.items.forEach((item, i) => {
    const where = `content/items.json item[${i}]${item?.id ? ` (${item.id})` : ""}`;
    if (!item?.id) fail(where, "missing a non-empty id");
    else if (seen.has(item.id)) fail(where, `duplicate item id "${item.id}"`);
    else seen.add(item.id);

    if (!item?.framing?.trim()) fail(where, "framing is missing or empty");

    if (!Array.isArray(item?.options) || item.options.length < 2) {
      fail(where, "needs at least two options");
      return;
    }
    const seenOptions = new Set();
    item.options.forEach((option, j) => {
      if (!option?.id) fail(`${where}.options[${j}]`, "missing a non-empty id");
      else if (seenOptions.has(option.id)) {
        fail(`${where}.options[${j}]`, `duplicate option id "${option.id}"`);
      } else seenOptions.add(option.id);
    });
  });

  return seen;
}

function checkRoster(roster) {
  if (!roster) return;
  if (!Array.isArray(roster.participants)) {
    fail("content/roster.json", 'expected an object with a "participants" array');
    return;
  }
  const seen = new Set();
  roster.participants.forEach((participant, i) => {
    const where = `content/roster.json participants[${i}]`;
    if (!participant?.id) fail(where, "missing a non-empty id");
    else if (seen.has(participant.id)) fail(where, `duplicate id "${participant.id}"`);
    else seen.add(participant.id);
    if (!participant?.password) fail(where, `(${participant?.id}) missing a password`);
  });
}

/* Keys app.js asks for by name. A missing one is not a crash — it renders to
 * the participant as literal "[intro.start]" — so it has to be checked here. */
const REQUIRED_STRINGS = [
  "app.title",
  "login.heading", "login.idLabel", "login.passwordLabel", "login.submit",
  "login.empty", "login.invalid",
  "intro.heading", "intro.body", "intro.start",
  "item.progress", "item.hint", "item.next",
  "summary.heading", "summary.intro", "summary.closing"
];

function checkStrings(strings) {
  if (!strings) return;
  for (const path of REQUIRED_STRINGS) {
    const value = path.split(".").reduce((node, key) => node?.[key], strings);
    if (value === undefined) fail("content/strings.json", `missing key "${path}"`);
  }
}

/* -------------------------------------------------------------------------
 * config.js — imported, so a syntax error is caught here rather than by a
 * participant looking at a blank page
 * ---------------------------------------------------------------------- */

async function checkConfig(itemIds) {
  let CONFIG;
  try {
    ({ CONFIG } = await import(pathToFileURL(join(root, "config.js")).href));
  } catch (error) {
    fail("config.js", `could not be loaded — ${error.message}`);
    return;
  }
  if (typeof CONFIG !== "object" || CONFIG === null) {
    fail("config.js", "does not export a CONFIG object");
    return;
  }

  const oneOf = (key, allowed) => {
    if (!allowed.includes(CONFIG[key])) {
      fail("config.js", `${key} is ${JSON.stringify(CONFIG[key])}; expected one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}`);
    }
  };
  oneOf("writeMode", ["cors", "no-cors", "beacon"]);
  oneOf("authMode", ["roster", "remote"]);
  oneOf("selectionMode", ["confirm", "immediate"]);
  oneOf("summaryItemText", ["framing", "label"]);

  if (typeof CONFIG.endpoint !== "string") {
    fail("config.js", "endpoint must be a string (empty string = dry run)");
  }
  if (!Number.isInteger(CONFIG.confirmDelayMs) || CONFIG.confirmDelayMs < 0) {
    fail("config.js", "confirmDelayMs must be a whole number of milliseconds");
  }

  // The cross-file check: an id here that is not in items.json stops the app
  // at startup, which is correct but late.
  if (CONFIG.itemSubset !== null && CONFIG.itemSubset !== undefined) {
    if (!Array.isArray(CONFIG.itemSubset) || CONFIG.itemSubset.length === 0) {
      fail("config.js", "itemSubset must be a non-empty array of item ids, or null");
    } else if (itemIds) {
      for (const id of CONFIG.itemSubset) {
        if (!itemIds.has(id)) fail("config.js", `itemSubset names "${id}", which is not in items.json`);
      }
    }
  }
  if (CONFIG.itemLimit !== null && CONFIG.itemLimit !== undefined) {
    if (!Number.isInteger(CONFIG.itemLimit) || CONFIG.itemLimit < 1) {
      fail("config.js", "itemLimit must be a whole number of 1 or more, or null");
    }
  }

  // Not failures — things worth seeing in the build log before they surprise
  // someone. A short run or a dry run is legitimate; silently shipping one is
  // what causes trouble.
  if (!CONFIG.endpoint) notes.push("endpoint is empty: the deployed build will not write any rows");
  if (CONFIG.itemSubset || CONFIG.itemLimit) {
    notes.push(`short run configured: itemSubset=${JSON.stringify(CONFIG.itemSubset)} itemLimit=${JSON.stringify(CONFIG.itemLimit)}`);
  }
  if (CONFIG.authMode === "remote") notes.push('authMode is "remote", which the MVP does not implement');
}

/* ---------------------------------------------------------------------- */

const [items, roster, strings] = await Promise.all([
  readJSON("content/items.json"),
  readJSON("content/roster.json"),
  readJSON("content/strings.json")
]);

const itemIds = checkItems(items);
checkRoster(roster);
checkStrings(strings);
await checkConfig(itemIds);

for (const note of notes) console.log(`note:  ${note}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — not safe to deploy:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`\n✓ ${items?.items.length ?? 0} items, ${roster?.participants.length ?? 0} participants, config.js loads. Safe to deploy.\n`);
