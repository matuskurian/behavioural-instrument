/* ==========================================================================
 * Behavioural instrument — MVP
 * --------------------------------------------------------------------------
 * Application logic only. This file contains:
 *   no participant-facing text   (content/strings.json, §4.4)
 *   no item or option content    (content/items.json, §4.1)
 *   no credentials               (content/roster.json, §5)
 *   no endpoint URL or flags     (config.js, §3)
 *   no styling                   (theme.css, §10)
 *
 * Adding an item, changing a caption, swapping an image, retheming or
 * repointing the endpoint must never require an edit here (§3, §13).
 * ========================================================================== */

import { CONFIG } from "./config.js";

/* ==========================================================================
 * Session state
 * ========================================================================== */

const session = {
  participantId: null,
  items: [],          // validated, in presentation order
  index: 0,           // index of the item currently on screen
  choices: [],        // [{ item, option, row }] — drives the summary screen
  locked: false,      // true between a choice and the advance (§8)
  screen: null        // "login" | "intro" | "item" | "summary" | "error"
};

let strings = {};
let roster = { participants: [] };
const transmission = { attempted: 0, failed: 0, failures: [] };

/* ==========================================================================
 * Tiny DOM helpers — no styling, class names only
 * ========================================================================== */

const root = document.getElementById("app");

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function show(screenName, node) {
  session.screen = screenName;
  root.replaceChildren(node);
  const focusTarget = node.querySelector("[data-autofocus]");
  if (focusTarget) focusTarget.focus();
}

/* ==========================================================================
 * Strings (§4.4)
 * --------------------------------------------------------------------------
 * t("login.submit") resolves a dotted path in strings.json.
 * t("item.progress", { current: 3, total: 12 }) substitutes {placeholders}.
 * A missing key renders as [login.submit] so the gap is obvious in testing
 * rather than silently blank.
 *
 * Any key may carry a variant for the selection mode in force: "intro.body"
 * is used unless "intro.body__immediate" exists and CONFIG.selectionMode is
 * "immediate". Copy that describes the interaction therefore lives with the
 * copy, and switching the mode stays a one-line change to config.js.
 * ========================================================================== */

function lookup(path) {
  return path.split(".").reduce(
    (node, key) => (node && typeof node === "object" ? node[key] : undefined),
    strings
  );
}

function forMode(path) {
  const variant = `${path}__${CONFIG.selectionMode}`;
  return lookup(variant) === undefined ? path : variant;
}

function t(path, vars) {
  const value = lookup(forMode(path));
  if (typeof value !== "string") {
    console.warn(`[strings] missing key: ${path}`);
    return `[${path}]`;
  }
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

function paragraphs(path, className = "body-text") {
  const value = lookup(forMode(path));
  const list = Array.isArray(value) ? value : [t(path)];
  return list.map((line) => el("p", { class: className, text: line }));
}

/* ==========================================================================
 * Content loading and validation (§4.3)
 * ========================================================================== */

async function loadJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error.message})`);
  }
}

/**
 * Returns an array of human-readable problems. Empty array means valid.
 * A malformed content file must fail loudly, not silently mislabel data.
 */
function validateItems(data) {
  const problems = [];
  if (!data || !Array.isArray(data.items)) {
    return ['items.json: expected an object with an "items" array'];
  }
  if (data.items.length === 0) problems.push("items.json: the items array is empty");

  const seenItemIds = new Set();
  data.items.forEach((item, i) => {
    const where = `item[${i}]${item && item.id ? ` (${item.id})` : ""}`;

    if (!item || typeof item !== "object") {
      problems.push(`${where}: not an object`);
      return;
    }
    if (typeof item.id !== "string" || item.id.trim() === "") {
      problems.push(`${where}: missing a non-empty string id`);
    } else if (seenItemIds.has(item.id)) {
      problems.push(`${where}: duplicate item id "${item.id}"`);
    } else {
      seenItemIds.add(item.id);
    }

    if (typeof item.framing !== "string" || item.framing.trim() === "") {
      problems.push(`${where}: framing is missing or empty`);
    }

    if (!Array.isArray(item.options) || item.options.length < 2) {
      problems.push(`${where}: needs an options array with at least two entries`);
      return;
    }

    const seenOptionIds = new Set();
    item.options.forEach((option, j) => {
      const optionWhere = `${where}.options[${j}]`;
      if (!option || typeof option !== "object") {
        problems.push(`${optionWhere}: not an object`);
        return;
      }
      if (typeof option.id !== "string" || option.id.trim() === "") {
        problems.push(`${optionWhere}: missing a non-empty string id`);
      } else if (seenOptionIds.has(option.id)) {
        problems.push(`${optionWhere}: duplicate option id "${option.id}" within this item`);
      } else {
        seenOptionIds.add(option.id);
      }
      if (typeof option.caption !== "string") {
        problems.push(`${optionWhere}: caption must be a string (may be empty)`);
      }
    });
  });

  return problems;
}

function validateRoster(data) {
  if (!data || !Array.isArray(data.participants)) {
    return ['roster.json: expected an object with a "participants" array'];
  }
  const problems = [];
  const seen = new Set();
  data.participants.forEach((participant, i) => {
    if (!participant || typeof participant.id !== "string" || participant.id.trim() === "") {
      problems.push(`roster.participants[${i}]: missing a non-empty string id`);
      return;
    }
    if (seen.has(participant.id)) problems.push(`roster: duplicate id "${participant.id}"`);
    seen.add(participant.id);
    if (typeof participant.password !== "string" || participant.password === "") {
      problems.push(`roster.participants[${i}] (${participant.id}): missing a password`);
    }
  });
  return problems;
}

/* ==========================================================================
 * Write path (§6.2)
 * --------------------------------------------------------------------------
 * Fire-and-forget. The participant advances immediately regardless of the
 * outcome; a failed transmission loses that one row and nothing else. There
 * is no queue, no retry, no blocking, and the participant is never told.
 * Failures are visible to the developer in the console only.
 * ========================================================================== */

/** ISO 8601, local time with the offset, to the second: 2026-09-14T10:31:07+02:00 */
function isoWithOffset(date) {
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`
  );
}

function noteFailure(row, reason) {
  transmission.failed += 1;
  transmission.failures.push({ ...row, reason });
  console.error(
    `[write] failed  item=${row.item_id}  choice=${row.choice_id}  reason=${reason}`
  );
}

function transmit(row) {
  transmission.attempted += 1;

  if (!CONFIG.endpoint) {
    console.info("[write] dry run (config.endpoint is empty) — row not sent:", row);
    return;
  }

  const payload = JSON.stringify(row);
  // text/plain keeps this a CORS "simple request": no preflight, which an
  // Apps Script web app cannot answer.
  const contentType = "text/plain;charset=UTF-8";

  try {
    if (CONFIG.writeMode === "beacon") {
      const queued = navigator.sendBeacon(
        CONFIG.endpoint,
        new Blob([payload], { type: contentType })
      );
      if (!queued) noteFailure(row, "sendBeacon refused the payload");
      return;
    }

    const opaque = CONFIG.writeMode === "no-cors";
    fetch(CONFIG.endpoint, {
      method: "POST",
      mode: opaque ? "no-cors" : "cors",
      cache: "no-store",
      keepalive: true,
      redirect: "follow",
      headers: { "Content-Type": contentType },
      body: payload
    })
      .then((response) => {
        // An opaque response carries no status; only network-level failure is
        // detectable in that mode.
        if (opaque) return;
        if (!response.ok) noteFailure(row, `HTTP ${response.status}`);
      })
      .catch((error) => noteFailure(row, error && error.message ? error.message : String(error)));
  } catch (error) {
    noteFailure(row, error && error.message ? error.message : String(error));
  }
}

/* ==========================================================================
 * Auth (§5)
 * --------------------------------------------------------------------------
 * The screen below knows only that it hands a credential to checkCredential
 * and gets back a participant id or null. Swapping to authMode "remote"
 * (§12.1) replaces this function, not the screen.
 * ========================================================================== */

async function checkCredential(id, password) {
  if (CONFIG.authMode === "remote") {
    throw new Error('authMode "remote" is not implemented in the MVP (§12.1)');
  }
  const match = roster.participants.find(
    (participant) => participant.id === id && participant.password === password
  );
  return match ? match.id : null;
}

/* ==========================================================================
 * Back-button interception (§8)
 * --------------------------------------------------------------------------
 * There is no back navigation and no answer revision. One spare history entry
 * is pushed when the session starts; every attempt to pop it pushes it again,
 * so Back is inert for the duration of the session.
 * ========================================================================== */

let historyPinned = false;

function pinHistory() {
  if (historyPinned) return;
  historyPinned = true;
  history.pushState({ instrument: true }, "");
  window.addEventListener("popstate", () => {
    if (session.screen === "item" || session.screen === "intro") {
      history.pushState({ instrument: true }, "");
    }
  });
}

/* ==========================================================================
 * Screens (§7)
 * ========================================================================== */

/* --- login ---------------------------------------------------------------- */

function renderLogin(prefillId = "") {
  const error = el("p", { class: "form-error", hidden: true, role: "alert" });

  const idInput = el("input", {
    class: "field__input",
    id: "participant-id",
    type: "text",
    name: "participant-id",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: false,
    value: prefillId
  });
  idInput.setAttribute("data-autofocus", "");

  const passwordInput = el("input", {
    class: "field__input",
    id: "participant-password",
    type: "password",
    name: "participant-password",
    autocomplete: "off",
    spellcheck: false
  });

  const form = el(
    "form",
    {
      class: "panel panel--narrow",
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        const id = idInput.value.trim();
        const password = passwordInput.value;

        if (!id || !password) {
          error.textContent = t("login.empty");
          error.hidden = false;
          return;
        }
        try {
          const participantId = await checkCredential(id, password);
          if (!participantId) {
            error.textContent = t("login.invalid");
            error.hidden = false;
            passwordInput.value = "";
            passwordInput.focus();
            return;
          }
          session.participantId = participantId;
          pinHistory();
          renderIntro();
        } catch (failure) {
          showError([`login: ${failure.message}`]);
        }
      }
    },
    [
      el("h1", { class: "heading", text: t("login.heading") }),
      ...paragraphs("login.intro", "body-text muted"),
      error,
      el("label", { class: "field" }, [
        el("span", { class: "field__label", text: t("login.idLabel") }),
        idInput
      ]),
      el("label", { class: "field" }, [
        el("span", { class: "field__label", text: t("login.passwordLabel") }),
        passwordInput
      ]),
      el("button", { class: "button", type: "submit", text: t("login.submit") })
    ]
  );

  show("login", el("section", { class: "screen screen--centred" }, form));
}

/* --- intro (§7) ----------------------------------------------------------- */

function renderIntro() {
  const start = el("button", {
    class: "button",
    type: "button",
    text: t("intro.start"),
    onclick: () => {
      session.index = 0;
      renderItem();
    }
  });
  start.setAttribute("data-autofocus", "");

  const panel = el("div", { class: "panel" }, [
    el("h1", { class: "heading", text: t("intro.heading") }),
    ...paragraphs("intro.body"),
    el("p", { class: "body-text" }, start)
  ]);

  show("intro", el("section", { class: "screen screen--centred" }, panel));
}

/* --- item (§7, §8, §9) ----------------------------------------------------
 * Two-step selection (CONFIG.selectionMode "confirm", the default):
 *   1. clicking an option draws a frame on its picture and reveals "Další"
 *   2. clicking "Další" writes the row and advances
 * Clicking a different option moves the frame; clicking the framed option
 * again does nothing at all. Nothing is written until step 2, so a change of
 * mind before "Další" leaves no trace: the row is the answer the participant
 * settled on, not the one they first touched. The timestamp is therefore the
 * moment of "Další", not the moment of the first click.
 *
 * CONFIG.selectionMode "immediate" restores the original single-click
 * behaviour, where the first click is the answer.
 * ------------------------------------------------------------------------ */

/** Everything about the item on screen. The keyboard handler, the highlight
 *  swap and the double-tap guard all read from here. */
const current = {
  item: null,
  buttons: [],
  pending: null,   // { option, button } — framed, not yet committed
  hint: null,
  next: null
};

function optionMedia(option) {
  const hasImage = typeof option.image === "string" && option.image.trim() !== "";
  const media = el("span", {
    class: hasImage ? "option__media" : "option__media option__media--placeholder"
  });

  if (hasImage) {
    // A path that 404s degrades to the same white placeholder rather than a
    // broken-image icon (§4.2).
    const image = el("img", {
      class: "option__image",
      src: option.image,
      alt: typeof option.alt === "string" && option.alt ? option.alt : option.caption || "",
      loading: "eager",
      decoding: "async",
      draggable: false,
      onerror: () => {
        media.className = "option__media option__media--placeholder";
        console.warn(`[assets] image failed to load: ${option.image}`);
      }
    });
    media.appendChild(image);
  }
  return media;
}

function renderItem() {
  const item = session.items[session.index];
  session.locked = false;

  const buttons = [];

  const cards = item.options.map((option, i) => {
    const button = el(
      "button",
      {
        class: "option__button",
        type: "button",
        "aria-pressed": "false",
        // event.detail is 0 when the click came from Enter/Space rather than a
        // pointer; that is what decides whether focus follows to "Další".
        onclick: (event) => select(option, button, event.detail === 0)
      },
      [
        optionMedia(option),
        el("span", { class: "option__caption", text: option.caption || "" }),
        CONFIG.numericShortcuts && i < 9
          ? el("span", { class: "option__key", text: String(i + 1), "aria-hidden": "true" })
          : null
      ]
    );
    buttons.push(button);
    return el("li", { class: "option" }, button);
  });

  const hint = el("p", { class: "item__hint", text: t("item.hint") });

  const next = el("button", {
    class: "button item__next",
    type: "button",
    hidden: true,
    text: t("item.next"),
    onclick: () => commit()
  });

  const screen = el("section", { class: "screen" }, [
    el("div", { class: "item" }, [
      el("h1", { class: "item__framing", text: item.framing }),
      el("ul", { class: "options" }, cards),
      // Hint and button share one reserved band, so revealing the button
      // cannot move the option strip under the participant's cursor.
      el("div", { class: "item__footer" }, [hint, next])
    ]),
    el("p", {
      class: "progress",
      text: t("item.progress", { current: session.index + 1, total: session.items.length })
    })
  ]);

  show("item", screen);
  // Nothing is auto-focused on an item screen: focusing the first card would
  // put a visible ring on one option and bias the choice. Tab reaches them.
  Object.assign(current, { item, buttons, pending: null, hint, next });
}

/** Step 1: move the frame. Writes nothing. */
function select(option, button, fromKeyboard) {
  if (session.locked) return;
  // Clicking the option that is already framed does nothing at all — no
  // re-render, no focus move, no row.
  if (current.pending && current.pending.option === option) return;

  for (const other of current.buttons) {
    other.classList.remove("option__button--selected");
    other.setAttribute("aria-pressed", "false");
  }
  button.classList.add("option__button--selected");
  button.setAttribute("aria-pressed", "true");
  current.pending = { option, button };

  if (CONFIG.selectionMode === "immediate") {
    commit();
    return;
  }

  current.hint.hidden = true;
  current.next.hidden = false;
  // Only when the participant is working by keyboard: a mouse user gets no
  // focus ring, and a keyboard user would otherwise have to tab past the
  // remaining cards to reach the button.
  if (fromKeyboard) current.next.focus();
}

/** Step 2: the answer. Writes the row and advances. */
function commit() {
  // Two guards, because a double-tap can land before the repaint that applies
  // the disabled attribute (§8, §13).
  if (session.locked || !current.pending) return;
  session.locked = true;

  for (const button of current.buttons) button.disabled = true;
  current.next.disabled = true;

  const item = current.item;
  const option = current.pending.option;

  const row = {
    timestamp: isoWithOffset(new Date()),
    participant_id: session.participantId,
    item_id: item.id,
    choice_id: option.id
  };

  session.choices.push({ item, option, row });
  transmit(row);

  window.setTimeout(() => {
    session.index += 1;
    if (session.index >= session.items.length) renderSummary();
    else renderItem();
  }, CONFIG.confirmDelayMs);
}

/* --- summary (§7) --------------------------------------------------------
 * The participant's own choices in order. No scoring, no interpretation, no
 * feedback. Rendered from session state; nothing here is written to the store
 * — every row shown was already written at the moment of the choice.
 * ------------------------------------------------------------------------ */

function renderSummary() {
  Object.assign(current, { item: null, buttons: [], pending: null, hint: null, next: null });

  const rows = session.choices.map(({ item, option }, i) => {
    const itemText =
      CONFIG.summaryItemText === "label" && item.label ? item.label : item.framing;

    return el("li", { class: "summary__row" }, [
      el("div", { class: "summary__media" }, optionMedia(option)),
      el("div", { class: "summary__text" }, [
        el("p", { class: "summary__item-text", text: itemText }),
        el("p", {
          class: "summary__choice",
          text: option.caption || t("summary.noCaption", { n: i + 1 })
        })
      ])
    ]);
  });

  const panel = el("div", { class: "panel summary" }, [
    el("h1", { class: "heading", text: t("summary.heading") }),
    ...paragraphs("summary.intro"),
    el("ul", { class: "summary__list" }, rows),
    el("p", { class: "body-text summary__closing", text: t("summary.closing") })
  ]);

  const screen = el("section", { class: "screen" }, panel);
  show("summary", screen);
  panel.querySelector(".heading").setAttribute("tabindex", "-1");
  panel.querySelector(".heading").focus();
}

/* --- error (§4.3) --------------------------------------------------------
 * Developer-facing. English is fine here: a participant should never see it,
 * and if they do, the person who needs to read it is the researcher.
 * ------------------------------------------------------------------------ */

function showError(problems) {
  const panel = el("div", { class: "panel" }, [
    el("h1", { class: "heading", text: "Configuration error" }),
    el("p", {
      class: "body-text",
      text:
        "The session was not started because the content files did not pass " +
        "validation. Fix the problems below and reload. No data has been written."
    }),
    el(
      "ul",
      { class: "error__list" },
      problems.map((problem) => el("li", { text: problem }))
    )
  ]);
  console.error("[content] validation failed:\n" + problems.map((p) => "  - " + p).join("\n"));
  show("error", el("section", { class: "screen screen--centred" }, panel));
}

/* ==========================================================================
 * Keyboard (§8)
 * --------------------------------------------------------------------------
 * Cards are <button>s, so Tab / Enter / Space work natively, and so is
 * "Další". Numeric keys are the cheap shortcut on top: they frame an option,
 * exactly as clicking it would, and never advance on their own.
 * ========================================================================== */

window.addEventListener("keydown", (event) => {
  if (!CONFIG.numericShortcuts) return;
  if (session.screen !== "item" || session.locked) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  // A held key or a stray keystroke into a field must never count as a choice.
  const target = event.target;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
    return;
  }

  const position = Number(event.key);
  if (!Number.isInteger(position) || position < 1) return;

  const button = current.buttons[position - 1];
  const option = current.item && current.item.options[position - 1];
  if (!button || !option) return;

  event.preventDefault();
  select(option, button, true);
});

/* ==========================================================================
 * Boot
 * ========================================================================== */

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Applies CONFIG.itemSubset and CONFIG.itemLimit to the item set, so that a
 * short run needs no edit to items.json (§4.1: item count is still driven by
 * the content file; this only narrows what is presented from it).
 *
 * Selection runs after validation, deliberately: a malformed item fails the
 * whole file even when this run would not have reached it, so a short pilot
 * cannot hide a content error that the full run would hit.
 *
 * A subset id that is not in items.json is an error, never a quietly shorter
 * session — a typo must not cost you a run you only notice at analysis.
 */
function selectItems(all) {
  const problems = [];
  let selected = all;

  if (CONFIG.itemSubset !== null && CONFIG.itemSubset !== undefined) {
    if (!Array.isArray(CONFIG.itemSubset) || CONFIG.itemSubset.length === 0) {
      return { items: [], problems: ["config.itemSubset: expected an array of item ids, or null"] };
    }
    const byId = new Map(all.map((item) => [item.id, item]));
    selected = [];
    for (const id of CONFIG.itemSubset) {
      const item = byId.get(id);
      if (item) selected.push(item);
      else problems.push(`config.itemSubset: items.json has no item with id "${id}"`);
    }
  }

  if (CONFIG.itemLimit !== null && CONFIG.itemLimit !== undefined) {
    if (!Number.isInteger(CONFIG.itemLimit) || CONFIG.itemLimit < 1) {
      problems.push("config.itemLimit: expected a whole number of 1 or more, or null");
    } else {
      if (CONFIG.itemLimit > selected.length) {
        console.warn(
          `[content] itemLimit is ${CONFIG.itemLimit} but only ${selected.length} items are available; running all of them.`
        );
      }
      selected = selected.slice(0, CONFIG.itemLimit);
    }
  }

  if (!problems.length && selected.length === 0) {
    problems.push("config: itemSubset / itemLimit left no items to present");
  }
  return { items: selected, problems };
}

async function boot() {
  let items;
  try {
    const needsRoster = CONFIG.authMode === "roster";
    const [itemsData, stringsData, rosterData] = await Promise.all([
      loadJSON(CONFIG.content.items),
      loadJSON(CONFIG.content.strings),
      needsRoster ? loadJSON(CONFIG.content.roster) : Promise.resolve({ participants: [] })
    ]);
    items = itemsData;
    strings = stringsData;
    roster = rosterData;
  } catch (error) {
    showError([error.message, "The app cannot start without its content files."]);
    return;
  }

  const problems = validateItems(items).concat(
    CONFIG.authMode === "roster" ? validateRoster(roster) : []
  );
  if (problems.length) {
    showError(problems);
    return;
  }

  const selection = selectItems(items.items);
  if (selection.problems.length) {
    showError(selection.problems);
    return;
  }

  document.documentElement.lang = "cs";
  document.title = t("app.title");

  session.items = selection.items.map((item) =>
    CONFIG.shuffleOptions ? { ...item, options: shuffled(item.options) } : item
  );

  console.info(
    `[content] ${items.items.length} items loaded (version ${items.version || "unversioned"})`
  );
  // A short run must be impossible to start by accident: say so loudly, and
  // name the items, so a session is never quietly cut short.
  if (session.items.length !== items.items.length) {
    console.warn(
      `[content] SHORT RUN: presenting ${session.items.length} of ${items.items.length} items ` +
        `(${session.items.map((item) => item.id).join(", ")}). ` +
        "Set itemSubset and itemLimit to null in config.js for the full set."
    );
  }
  if (!CONFIG.endpoint) {
    console.warn("[write] dry run: config.endpoint is empty, no rows will be transmitted.");
  }

  // A handle for the researcher during logistics testing: transmission counts
  // and the rows that were lost. Not used by the app.
  window.__instrument = { session, transmission, CONFIG };

  renderLogin();
}

boot();
