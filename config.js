/*
 * Deployment configuration.
 *
 * This file is the only place that knows about the outside world: where rows
 * are written and which auth mode is in force. app.js must never contain an
 * endpoint URL or an auth assumption (§3, §12).
 */
export const CONFIG = {
  /* ------------------------------------------------------------------ *
   * Supabase — auth and the write path (§12.1, §12.2)
   * ------------------------------------------------------------------ */

  /**
   * Project base URL. No "/rest/v1", no trailing slash:
   *   https://abcdefghijklm.supabase.co
   */
  supabaseUrl: "https://gafgvugkyscisoicjcqc.supabase.co",

  /**
   * The anon / publishable key, and only that key.
   *
   * It is designed to ship in client source: on its own it can do nothing,
   * because row-level security allows an insert into public.responses only
   * when the caller is authenticated and writing rows for their own
   * participant_id. An anonymous insert is refused with 42501.
   *
   * A key labelled service_role or secret bypasses row-level security
   * completely. One of those in this file would hand every reader of this
   * public repository full read and write access to the responses table.
   * tools/validate.mjs decodes whatever is here and fails the build if it is
   * anything other than an anon/publishable key, and scans the rest of the
   * repository for the same mistake.
   */
  supabaseAnonKey: "sb_publishable_l9iWaABkrVEvwiFU9ZL6Qw_IKy-GqDA",

  /* ------------------------------------------------------------------ *
   * Auth (§12.1, §12.2)
   * ------------------------------------------------------------------ */

  /**
   * "remote"  the operating mode. The participant's code is turned into
   *           <code>@instrument.local and signed in against Supabase Auth;
   *           the returned session authorises every row written afterwards.
   *           Accounts are created by hand in the Supabase dashboard —
   *           signup is disabled.
   *
   * "roster"  offline mode, for layout and copy work with no network at all.
   *           Credentials are checked against content/roster.json in the
   *           client, which is not authentication in any meaningful sense
   *           (§2) — and nothing is written anywhere. That file is not in
   *           the repository; create it locally from
   *           content/roster.example.json when you need this mode.
   *
   * The roster path is unreachable while this is "remote": checkCredential()
   * returns or throws before it, and boot() does not even fetch the file.
   */
  authMode: "remote",

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

  /**
   * How long the summary screen waits for outstanding writes to be answered
   * before rendering, so that it lists what was recorded rather than what was
   * clicked. A choice still unanswered after this is shown anyway and logged
   * to the console: a slow network should delay the courtesy screen, never
   * withhold it. Set to 0 to render immediately.
   */
  summarySettleMs: 1500,

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

