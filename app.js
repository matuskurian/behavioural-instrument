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

/*
 * config.js is imported dynamically rather than with a static `import`.
 *
 * A static import failure is fatal to the importing module: if config.js has
 * so much as a stray comma, app.js never executes, nothing renders, and the
 * participant gets a blank white page — the error screen being itself part of
 * the code that failed to run. Loading it inside a try/catch means a broken
 * config produces the same loud, diagnostic error screen as broken content.
 *
 * CONFIG is null until boot() sets it; the two functions reachable before
 * that (forMode and the keydown listener) guard for it.
 */
let CONFIG = null;

async function loadConfig() {
  const module = await import("./config.js");
  if (!module || typeof module.CONFIG !== "object" || module.CONFIG === null) {
    throw new Error("config.js loaded but did not export a CONFIG object");
  }
  return module.CONFIG;
}

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
const transmission = { attempted: 0, failed: 0, duplicates: 0, failures: [] };

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
  if (!CONFIG) return path;
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

/**
 * Fetches the icon sprite once and puts it in the document, so that every
 * <use href="#icon-x"> is a same-document reference. That is what lets the
 * drawings inherit currentColor from the card they sit in, and it costs one
 * request for a whole item set instead of one per option.
 *
 * Failure is survivable by design: options fall back to a ring, and the
 * session runs. A missing picture must never stop a classroom.
 */
async function loadIcons(path) {
  if (!path) return;
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const holder = document.createElement("div");
    holder.innerHTML = await response.text();
    const sprite = holder.querySelector("svg");
    if (!sprite) throw new Error("no <svg> element in the sprite");
    sprite.setAttribute("aria-hidden", "true");
    sprite.setAttribute("focusable", "false");
    document.body.insertBefore(sprite, document.body.firstChild);
    console.info(`[assets] ${sprite.querySelectorAll("symbol").length} icons loaded from ${path}`);
  } catch (error) {
    console.warn(`[assets] icon sprite not loaded (${error.message}); options will show a ring`);
  }
}

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

/* --------------------------------------------------------------------------
 * The outside world (§12.6)
 * --------------------------------------------------------------------------
 * Supabase — its URL, its key, its headers, its tokens and its Postgres error
 * codes — exists between here and the end of transmit(), and nowhere else.
 * Everything below this block knows only that it hands a code and a password
 * to checkCredential() and gets back a participant id or null, and that it
 * hands a row to transmit() and carries on. If a Supabase detail turns up in
 * screen logic, content loading or theming, that is the defect §12 warns of.
 * ----------------------------------------------------------------------- */

/** Participant codes are turned into addresses for Supabase Auth. The domain
 *  is an implementation detail and is never shown to anyone (§12.3). */
const PARTICIPANT_EMAIL_DOMAIN = "@instrument.local";

/** Postgres, via PostgREST. 23505 is the unique (participant_id, item_id)
 *  constraint: the participant answered an item they had already answered,
 *  which resume makes possible. It is not data loss (§12.4). */
const DUPLICATE_ROW = "23505";

/** The signed-in session. Null under authMode "roster", and until sign-in. */
let auth = null;

function supabaseUrl(path) {
  return `${CONFIG.supabaseUrl.replace(/\/+$/, "")}${path}`;
}

/* --- sign-in and keeping the session alive (§12.3) ---------------------- */

/**
 * Returns the token payload, or null when the code or password is simply
 * wrong. Throws only when something is broken rather than mistyped — an
 * unreachable project, a bad key — because those two cases need different
 * answers: a Czech retry message, or the developer error screen.
 */
async function signIn(code, password) {
  const response = await fetch(supabaseUrl("/auth/v1/token?grant_type=password"), {
    method: "POST",
    cache: "no-store",
    headers: { apikey: CONFIG.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${code}${PARTICIPANT_EMAIL_DOMAIN}`, password })
  });

  if (response.ok) return response.json();

  // 400 is what Supabase Auth returns for invalid credentials, and also for an
  // account that exists but was never confirmed — the mistake the README warns
  // about, which is why the reason is logged rather than swallowed.
  if (response.status === 400) {
    const detail = await response.json().catch(() => ({}));
    console.warn(`[auth] sign-in refused: ${detail.error_code || detail.error || "invalid credentials"}`);
    return null;
  }

  throw new Error(`sign-in failed with HTTP ${response.status}`);
}

function holdSession(token) {
  const timer = auth && auth.timer;
  if (timer) window.clearTimeout(timer);
  auth = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: Number(token.expires_in) || 0,
    timer: null
  };
  scheduleRefresh(auth.expiresIn);
}

/**
 * Access tokens are short-lived and a resumed run can outlive one, so the
 * session is refreshed on a timer rather than lazily at write time: a write
 * must never wait for anything (§6.2). At 80% of the lifetime there is room
 * for a slow network, and a run shorter than the token's life never refreshes.
 */
function scheduleRefresh(expiresIn) {
  if (!auth || !Number.isFinite(expiresIn) || expiresIn <= 0) return;
  auth.timer = window.setTimeout(refreshSession, Math.max(30, Math.floor(expiresIn * 0.8)) * 1000);
}

async function refreshSession() {
  if (!auth) return;
  try {
    const response = await fetch(supabaseUrl("/auth/v1/token?grant_type=refresh_token"), {
      method: "POST",
      cache: "no-store",
      headers: { apikey: CONFIG.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: auth.refreshToken })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    holdSession(await response.json());
    console.info("[auth] session refreshed");
  } catch (error) {
    // There is nothing to do about it: the participant is mid-task and must
    // not be interrupted. Writes after the token expires will fail and be
    // logged like any other failure.
    console.error(`[auth] session refresh failed: ${error.message}. Later rows may be refused.`);
  }
}

/**
 * The login screen's whole view of authentication. Returns the participant id
 * on success and null on a wrong code or password.
 */
async function checkCredential(code, password) {
  if (CONFIG.authMode === "remote") {
    // Sign-in treats the address case-insensitively; the row-level security
    // policy does not. It compares participant_id against the local part of
    // the account's email, exactly, and Supabase stores that lowercased. A
    // participant typing TEST would therefore sign in happily and have every
    // single row refused with 42501 — invisibly, because writes are
    // fire-and-forget and nobody is ever told. Verified against the live
    // project on 2026-09-17: "test" accepted, "TEST" refused.
    const token = await signIn(code.trim().toLowerCase(), password);
    if (!token) return null;
    holdSession(token);

    // Take the id from the account that was actually signed in, not from what
    // was typed. It is the one value the policy is guaranteed to accept.
    const email = token.user && typeof token.user.email === "string" ? token.user.email : "";
    const fromAccount = email.split("@")[0];
    if (!fromAccount) throw new Error("sign-in returned no account email to derive participant_id from");
    return fromAccount;
  }

  // authMode "roster": offline only, and unreachable above. Not authentication
  // (§2) — it binds a response set to an identifier and nothing more.
  const match = roster.participants.find(
    (participant) => participant.id === code && participant.password === password
  );
  return match ? match.id : null;
}

/* --- writing a row (§6.2, §12.4) ---------------------------------------- */

function noteFailure(row, reason) {
  transmission.failed += 1;
  transmission.failures.push({ ...row, reason });
  console.error(
    `[write] failed  item=${row.item_id}  choice=${row.choice_id}  reason=${reason}`
  );
}

/** Not a failure: the row is already in the table, so the data is intact. */
function noteDuplicate(row) {
  transmission.duplicates += 1;
  console.info(`[write] duplicate, ignored  item=${row.item_id}  choice=${row.choice_id}`);
}

/**
 * Fire-and-forget, unchanged by the migration (§6.2, §12.4). Nothing here is
 * awaited by the caller, nothing is retried, nothing is queued: the
 * participant advances the instant they choose, whatever happens to the row.
 * server_ts is never sent — the database sets it.
 */
function transmit(row, onOutcome) {
  // The outcome is reported back in the store's own vocabulary translated into
  // four plain words, so that the summary can show only what was actually
  // recorded without learning anything about Postgres or HTTP.
  const settle = (outcome) => {
    if (typeof onOutcome === "function") onOutcome(outcome);
  };

  transmission.attempted += 1;

  if (CONFIG.authMode !== "remote") {
    console.info('[write] offline: authMode is not "remote", so no row was sent:', row);
    settle("offline");
    return;
  }
  if (!auth) {
    noteFailure(row, "no signed-in session");
    settle("failed");
    return;
  }

  try {
    fetch(supabaseUrl("/rest/v1/responses"), {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    })
      .then(async (response) => {
        if (response.ok) {
          settle("recorded");
          return;
        }
        const detail = await response.json().catch(() => ({}));
        if (detail && detail.code === DUPLICATE_ROW) {
          noteDuplicate(row);
          // Not recorded: the stored answer is the earlier one, which this
          // client cannot read back and must therefore not claim to know.
          settle("duplicate");
          return;
        }
        const code = detail && detail.code ? ` ${detail.code}` : "";
        const message = detail && detail.message ? ` ${detail.message}` : "";
        noteFailure(row, `HTTP ${response.status}${code}${message}`);
        settle("failed");
      })
      .catch((error) => {
        noteFailure(row, error && error.message ? error.message : String(error));
        settle("failed");
      });
  } catch (error) {
    noteFailure(row, error && error.message ? error.message : String(error));
    settle("failed");
  }
}

/**
 * A misconfigured auth block must stop the session at startup rather than at
 * the first login, where a room full of people would read it as a wrong
 * password. Returns problems for the error screen, in the same shape the
 * content validators use — the only thing boot() learns is that something is
 * wrong, never what a Supabase URL or key is supposed to look like.
 */
function validateAuthConfig() {
  const problems = [];

  if (CONFIG.authMode === "remote") {
    if (typeof CONFIG.supabaseUrl !== "string" || CONFIG.supabaseUrl.trim() === "") {
      problems.push('config.supabaseUrl is empty, which authMode "remote" requires');
    } else if (!/^https:\/\/[^/]+$/.test(CONFIG.supabaseUrl.replace(/\/+$/, ""))) {
      problems.push(
        `config.supabaseUrl should be the project base URL with no path — got "${CONFIG.supabaseUrl}"`
      );
    }
    if (typeof CONFIG.supabaseAnonKey !== "string" || CONFIG.supabaseAnonKey.trim() === "") {
      problems.push('config.supabaseAnonKey is empty, which authMode "remote" requires');
    }
  } else if (CONFIG.authMode !== "roster") {
    problems.push(`config.authMode is "${CONFIG.authMode}"; expected "remote" or "roster"`);
  }

  return problems;
}

/**
 * Says where rows are going, at startup. It lives here rather than in boot()
 * because the shape of that URL is precisely what boot() must not know.
 */
function announceWriteTarget() {
  if (CONFIG.authMode === "remote") {
    console.info(`[write] rows go to ${supabaseUrl("/rest/v1/responses")}`);
  } else {
    console.warn(
      `[write] offline: authMode is "${CONFIG.authMode}", so nothing will be transmitted anywhere.`
    );
  }
}

/* --------------------------------------------------------------------------
 * End of the outside world. Nothing below knows Supabase exists.
 * ----------------------------------------------------------------------- */

/* ==========================================================================
 * Resume after interruption (§12.5)
 * --------------------------------------------------------------------------
 * localStorage holds, per session, who is answering, which item comes next,
 * and when the last choice was made. A participant whose tab dies gets back
 * to where they were instead of starting again or being locked out.
 *
 * Answers themselves are deliberately not restored. The summary after a
 * resumed session shows only the choices made since the resume: it is a
 * courtesy screen, not a data view, and the client cannot read the table back
 * even if it wanted to — there is no select policy (§12.1).
 *
 * The unique constraint on (participant_id, item_id) is the backstop, not the
 * mechanism. First answer wins by construction.
 * ========================================================================== */

const RESUME_KEY = "instrument.session";

/** Two hours, counted from the last choice rather than from login (§12.5). */
const RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/* Private browsing and some locked-down school configurations make every
   localStorage access throw. That must cost the resume feature and nothing
   else, so every access is wrapped and the warning is printed once. */
let storageWorks = true;

function noteStorageUnavailable(error) {
  if (!storageWorks) return;
  storageWorks = false;
  console.warn(
    `[resume] localStorage is unavailable (${(error && error.message) || error}). ` +
      "Resume is off for this session; the instrument is otherwise unaffected."
  );
}

function readResume() {
  try {
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (
      !stored ||
      typeof stored.participant_id !== "string" ||
      !Number.isInteger(stored.index) ||
      !Number.isFinite(stored.updated)
    ) {
      return null;
    }
    return stored;
  } catch (error) {
    noteStorageUnavailable(error);
    return null;
  }
}

function writeResume(nextIndex) {
  try {
    window.localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        participant_id: session.participantId,
        index: nextIndex,
        updated: Date.now()
      })
    );
  } catch (error) {
    noteStorageUnavailable(error);
  }
}

function clearResume() {
  try {
    window.localStorage.removeItem(RESUME_KEY);
  } catch (error) {
    noteStorageUnavailable(error);
  }
}

/**
 * The item index to continue from, or null to start at the intro. Anything
 * that does not match on all three counts — same participant, less than two
 * hours old, pointing somewhere inside this run — clears the stored session
 * rather than half-trusting it.
 *
 * index 0 deliberately does not resume: nothing has been answered, and
 * skipping the intro for someone who never read it would be wrong. An index
 * at or past the end is a run that finished without reaching the summary, and
 * also starts fresh; the unique constraint makes the re-answers harmless.
 */
function resumeIndexFor(participantId) {
  const stored = readResume();
  if (!stored) return null;

  const sameParticipant = stored.participant_id === participantId;
  const recent = Date.now() - stored.updated < RESUME_MAX_AGE_MS;
  const insideThisRun = stored.index > 0 && stored.index < session.items.length;

  if (sameParticipant && recent && insideThisRun) return stored.index;

  if (!sameParticipant) console.info("[resume] stored session belongs to another participant; discarded");
  else if (!recent) console.info("[resume] stored session is older than two hours; discarded");
  else console.info("[resume] stored session does not point inside this run; discarded");

  clearResume();
  return null;
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

          // A returning participant continues where they stopped; everyone
          // else, including the same participant after two hours, sees the
          // intro (§12.5).
          const resumeAt = resumeIndexFor(participantId);
          if (resumeAt === null) {
            renderIntro();
          } else {
            console.info(
              `[resume] continuing at item ${resumeAt + 1} of ${session.items.length}`
            );
            session.index = resumeAt;
            renderItem();
          }
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
  pending: null,     // { option, button } — framed, not yet committed
  next: null,

  /* Behavioural measurement of the choice itself, not of the answer.
   * Times come from performance.now(), which is monotonic from page load:
   * a school laptop whose clock jumps mid-session cannot corrupt a duration
   * the way it corrupts client_ts. */
  renderedAt: 0,     // when this item appeared
  firstTouchAt: null, // when the frame was first placed, null until then
  moves: 0           // times the frame moved to a different option after that
};

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The drawing for one option, as a same-document <use> into the sprite.
 *
 * It is aria-hidden and carries no alt text, deliberately. A screen reader
 * describing the picture would tell that child something the sighted child
 * does not get — the caption is the option, the drawing is decoration.
 *
 * An option whose drawing has not been made yet, or a sprite that failed to
 * load at all, falls back to a ring of the same geometry: a half-illustrated
 * item set looks deliberate rather than broken, and a missing picture is never
 * a reason to stop a classroom.
 */
function optionMedia(option) {
  const media = el("span", { class: "option__media" });
  const named = typeof option.icon === "string" && option.icon.trim() !== "";
  const id = named ? `icon-${option.icon.trim()}` : "icon-placeholder";
  const symbol = document.getElementById(id) || document.getElementById("icon-placeholder");

  if (!symbol) {
    // No sprite at all. CSS draws the ring instead so the card keeps its shape.
    media.classList.add("option__media--empty");
    if (named) console.warn(`[assets] no icon "${option.icon}" and no sprite to fall back on`);
    return media;
  }
  if (named && symbol.id !== id) {
    console.warn(`[assets] icon "${option.icon}" is not in the sprite; using the placeholder`);
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "option__icon");
  svg.setAttribute("viewBox", symbol.getAttribute("viewBox") || "0 0 240 240");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${symbol.id}`);
  svg.appendChild(use);
  media.appendChild(svg);
  return media;
}

/**
 * The bar across the top of an item screen: who this is, and how far through.
 * The bars are decorative — the count beside them carries the same information
 * as text, so a screen reader is not read a row of empty list items.
 */
function masthead(current1, total) {
  const bars = el("div", { class: "progress__bars", "aria-hidden": "true" });
  for (let i = 0; i < total; i += 1) {
    bars.appendChild(el("i", { class: i < current1 ? "is-done" : "" }));
  }

  return el("header", { class: "masthead" }, [
    el("div", { class: "wordmark" }, [
      el("span", { class: "wordmark__name", text: t("app.wordmark") }),
      el("span", { class: "wordmark__tagline", text: t("app.tagline") })
    ]),
    el("div", { class: "progress" }, [
      bars,
      el("p", {
        class: "progress__count",
        text: t("item.progress", { current: current1, total })
      })
    ])
  ]);
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
        // The keyboard shortcuts still work; the badge is off by default
        // because the design does not have one. showShortcutHints brings it back.
        CONFIG.numericShortcuts && CONFIG.showShortcutHints && i < 9
          ? el("span", { class: "option__key", text: String(i + 1), "aria-hidden": "true" })
          : null
      ]
    );
    buttons.push(button);
    return el("li", { class: "option" }, button);
  });

  const next = el("button", {
    class: "button item__next",
    type: "button",
    hidden: true,
    text: t("item.next"),
    onclick: () => commit()
  });

  const current1 = session.index + 1;
  const total = session.items.length;

  const screen = el("section", { class: "screen screen--item" }, [
    masthead(current1, total),
    el("div", { class: "item" }, [
      el("div", { class: "item__question" }, [
        el("p", { class: "item__eyebrow", text: t("item.eyebrow", { current: current1, total }) }),
        el("h1", { class: "item__framing", text: item.framing }),
        el("p", { class: "item__lead", text: item.lead || t("item.lead") })
      ]),
      el("ul", { class: "options" }, cards),
      // The band is reserved whether or not the button is in it, so revealing
      // the button cannot move the cards under the participant's cursor.
      el("div", { class: "item__footer" }, next)
    ])
  ]);

  show("item", screen);
  // Nothing is auto-focused on an item screen: focusing the first card would
  // put a visible ring on one option and bias the choice. Tab reaches them.
  Object.assign(current, {
    item,
    buttons,
    pending: null,
    next,
    // The clock starts when the item is on screen, so the duration includes
    // reading the framing — which is what was asked for.
    renderedAt: performance.now(),
    firstTouchAt: null,
    moves: 0
  });
}

/** Step 1: move the frame. Writes nothing. */
function select(option, button, fromKeyboard) {
  if (session.locked) return;
  // Clicking the option that is already framed does nothing at all — no
  // re-render, no focus move, no row, and no counted change of mind.
  if (current.pending && current.pending.option === option) return;

  if (current.firstTouchAt === null) current.firstTouchAt = performance.now();
  else current.moves += 1;   // the frame moved to a different option

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

  // The row as the table expects it (§12.1). server_ts is the database's to
  // set, and is never sent.
  //
  // shown_order and shown_position are what make the randomisation worth
  // doing: without them there is no way to tell an option chosen for what it
  // says from one chosen for being leftmost, and randomising while failing to
  // record the order would destroy that information rather than control for it.
  const committedAt = performance.now();
  const row = {
    participant_id: session.participantId,
    item_id: item.id,
    choice_id: option.id,
    client_ts: isoWithOffset(new Date()),
    shown_order: item.options.map((each) => each.id),
    shown_position: item.options.indexOf(option) + 1,
    // Render to answer-final: the single click in "immediate", the "Další"
    // click in "confirm".
    response_time_ms: Math.round(committedAt - current.renderedAt),
    // Render to the frame first landing anywhere. In "immediate" this is the
    // same event as the commit, so the two times coincide by construction.
    first_touch_ms:
      current.firstTouchAt === null
        ? null
        : Math.round(current.firstTouchAt - current.renderedAt),
    frame_moves: current.moves
  };

  // The summary must show what was recorded, not what was clicked, so each
  // choice carries the fate of its own row. "pending" until the store answers.
  const choice = { item, option, row, status: "pending" };
  session.choices.push(choice);
  transmit(row, (outcome) => {
    choice.status = outcome;
  });
  // Refreshed at every choice, so the two-hour window runs from the last thing
  // the participant did rather than from when they logged in (§12.5).
  writeResume(session.index + 1);

  window.setTimeout(() => {
    session.index += 1;
    if (session.index >= session.items.length) renderSummary();
    else renderItem();
  }, CONFIG.confirmDelayMs);
}

/* --- summary (§7) --------------------------------------------------------
 * The participant's own choices in order. No scoring, no interpretation, no
 * feedback. Nothing here is written to the store.
 *
 * It shows only the choices that were actually recorded. A choice the store
 * refused as a duplicate was not recorded — the stored answer is the earlier
 * one, and this client has no select policy and so cannot read it back to
 * display it (§12.1). Showing the clicked option instead would tell the
 * participant something untrue about their own data, which matters most
 * precisely when someone is being asked to talk about what they chose.
 * ------------------------------------------------------------------------ */

/** Outcomes that mean the answer stands: it reached the table, or there is no
 *  table to reach because the instrument is running offline. */
const RECORDED = ["recorded", "offline"];

async function renderSummary() {
  Object.assign(current, { item: null, buttons: [], pending: null, next: null });
  // The run is over: nothing left to resume into (§12.5).
  clearResume();

  // The last write is fired a few hundred milliseconds before this screen, so
  // give the store a bounded moment to answer rather than guessing. Bounded:
  // a slow network must delay the courtesy screen, never withhold it.
  const deadline = Date.now() + CONFIG.summarySettleMs;
  while (session.choices.some((c) => c.status === "pending") && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  const unsettled = session.choices.filter((c) => c.status === "pending").length;
  if (unsettled) {
    console.warn(
      `[summary] ${unsettled} write(s) had not answered within ${CONFIG.summarySettleMs}ms; ` +
        "shown as recorded. The store, not this screen, is the record."
    );
  }

  // Still-pending counts as shown: it was sent, and withholding it would be as
  // misleading as the problem this filter exists to fix.
  const shown = session.choices.filter(
    (c) => RECORDED.includes(c.status) || c.status === "pending"
  );
  const withheld = session.choices.length - shown.length;
  if (withheld) {
    console.info(
      `[summary] ${withheld} of ${session.choices.length} choices are not shown: ` +
        session.choices
          .filter((c) => !RECORDED.includes(c.status) && c.status !== "pending")
          .map((c) => `${c.row.item_id}/${c.row.choice_id} (${c.status})`)
          .join(", ")
    );
  }

  const rows = shown.map(({ item, option }, i) => {
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
    // A run in which every answer was already on record leaves nothing to
    // list. That is a normal outcome of returning to a finished session, not
    // an error, and it needs saying rather than showing an empty box.
    rows.length
      ? el("ul", { class: "summary__list" }, rows)
      : el("p", { class: "body-text muted", text: t("summary.nothingNew") }),
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
  if (!CONFIG || !CONFIG.numericShortcuts) return;
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
  try {
    CONFIG = await loadConfig();
  } catch (error) {
    showError([
      `config.js could not be loaded: ${error.message}`,
      "This is almost always a syntax error in config.js — a stray comma, a " +
        "missing quote, or an unclosed brace. The browser console names the line.",
      "No other file is at fault: the app stops here because nothing else can " +
        "be read without the paths config.js holds."
    ]);
    return;
  }

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

  const problems = validateItems(items)
    .concat(CONFIG.authMode === "roster" ? validateRoster(roster) : [])
    .concat(validateAuthConfig());
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

  // Before the first screen, so the first item already has its drawings.
  await loadIcons(CONFIG.content.icons);

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
  announceWriteTarget();

  // A handle for the researcher during logistics testing: transmission counts
  // and the rows that were lost. Not used by the app.
  window.__instrument = { session, transmission, CONFIG };

  renderLogin();
}

boot();
