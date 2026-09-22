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

  /**
   * Randomise the order of the options, independently for each item and each
   * participant. On, because a fixed order confounds "chose this option" with
   * "chose the leftmost thing".
   *
   * It is only safe to have on because every row records shown_order and
   * shown_position. Randomising without recording what was shown would destroy
   * the information rather than control for it — so if you ever turn this off,
   * leave the recording alone.
   *
   * The drawing travels with its option; the colour belongs to the position on
   * screen. Binding colour to content would put the bias straight back in.
   */
  shuffleOptions: true,

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
   *   itemSubset: ["Q13", "Q10"],          these two, in this order
   *
   * Currently listing all 24 items in reverse, Q24 first: the full set, in a
   * deliberate order rather than the file's. Every item is present exactly
   * once, so this changes the sequence and nothing else.
   */
  itemSubset: [
    "Q24", "Q23", "Q22", "Q21", "Q20", "Q19", "Q18", "Q17",
    "Q16", "Q15", "Q14", "Q13", "Q12", "Q11", "Q10", "Q09",
    "Q08", "Q07", "Q06", "Q05", "Q04", "Q03", "Q02", "Q01"
  ],
  itemLimit: null,
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

  /**
   * Whether each card also shows its shortcut number.
   *
   * Off: the design does not have one, and a numeral in the corner of a card
   * is another mark competing with the drawing. The shortcuts still work and
   * the intro explains them; this only controls whether they are labelled.
   */
  showShortcutHints: false,

  /** Paths to the content files. Here so a deployment can serve a different
   *  item set from the same code. */
  content: {
    items: "content/items.json",
    strings: "content/strings.json",
    roster: "content/roster.json",
    /** Built from the source drawings by tools/build-icons.ps1. */
    icons: "assets/icons.svg"
  }
};

