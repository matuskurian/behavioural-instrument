/*
 * Deployment configuration.
 *
 * This file is the only place that knows about the outside world: where rows
 * are written and which auth mode is in force. app.js must never contain an
 * endpoint URL or an auth assumption (§3, §12).
 */
export const CONFIG = {
  /* ------------------------------------------------------------------ *
   * Write path (§6.2)
   * ------------------------------------------------------------------ */

  /**
   * Google Apps Script web app URL, deployed as "Execute as: me",
   * "Who has access: anyone". See apps-script/Code.gs.
   *
   * Leave as "" to run in dry-run mode: rows are logged to the console and
   * nothing leaves the browser. Use this for think-alouds and layout work
   * before the sheet exists.
   */
  endpoint: "https://script.google.com/macros/s/AKfycbznc8ln9dPyzyzF9S7hHsB8jsSUHE-3DfnzbfRK6sIXBw1hEqx1HWAaz6xVFJPtB9O6/exec",

  /**
   * Transport for the fire-and-forget row POST.
   *
   *   "cors"    normal fetch; Apps Script's CORS headers let us see whether the
   *             request succeeded, so failures are logged with a real reason.
   *   "no-cors" opaque fetch; survives a misconfigured deployment but only
   *             network-level failures are detectable (HTTP 4xx/5xx look like
   *             success). Fallback only.
   *   "beacon"  navigator.sendBeacon; most robust against a page being closed
   *             mid-write, but reports only whether the send was queued.
   *
   * Whatever the mode, the participant is never blocked and never told (§6.2).
   */
  writeMode: "cors",

  /* ------------------------------------------------------------------ *
   * Auth (§5, §12.1)
   * ------------------------------------------------------------------ */

  /**
   * "roster"  credentials checked against content/roster.json in the client.
   *           Not real authentication — see §2.
   * "remote"  credentials POSTed to a server that returns a session token.
   *           Not implemented in the MVP; the login screen is structured so
   *           that adding it touches only auth.js-level code, not the screen.
   */
  authMode: "roster",

  /* ------------------------------------------------------------------ *
   * Presentation
   * ------------------------------------------------------------------ */

  /** §4.1: option order is array order in the MVP. Flag exists so it can be
   *  turned on later without touching logic. */
  shuffleOptions: false,

  /**
   * Run only part of the item set without touching items.json — for
   * think-alouds, a timing pilot, or a two-minute logistics test.
   *
   *   itemSubset  array of item ids, presented in the order given here:
   *               ["B03", "B01", "B07"]. null = every item, in file order.
   *   itemLimit   whole number: keep only the first N of whatever the subset
   *               left. null = no limit.
   *
   * They compose: itemSubset picks and orders, itemLimit then truncates.
   * An id that is not in items.json is a startup error, not a shorter
   * session, and any short run is announced in the console.
   *
   * Both must be null for run (b): the completion threshold is pre-registered
   * against a fixed item set (§6.2).
   *
   * Examples:
   *   itemLimit: 3,                        first three items
   *   itemSubset: ["B03", "B01", "B07"],   these three, in this order
   */
  itemSubset: ["B03", "B01", "B07"],
  itemLimit: 3,
  /**
   * How an option becomes an answer.
   *
   *   "confirm"    two steps: the first click frames the picture and reveals
   *                the "Další" button, which writes the row and advances.
   *                Until then the participant can move the frame freely, and
   *                only the settled choice is transmitted.
   *   "immediate"  one step: the first click is the answer, as in §7/§8 of the
   *                original spec.
   */
  selectionMode: "confirm",

  /** §14 open item: what identifies an item on the summary screen.
   *  "framing" full framing text | "label" the item's short `label`, falling
   *  back to framing if none is present. */
  summaryItemText: "framing",

  /** Milliseconds the chosen card is shown confirmed before advancing (§8). */
  confirmDelayMs: 450,

  /** §8: numeric shortcuts 1–9 for options. */
  numericShortcuts: true,

  /** Paths to the content files. Here so a deployment can serve a different
   *  item set from the same code. */
  content: {
    items: "content/items.json",
    strings: "content/strings.json",
    roster: "content/roster.json"
  }
};

