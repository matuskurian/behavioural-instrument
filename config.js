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
   * It is only safe to have on because every row records option_order and
   * option_position. Randomising without recording what was shown would
   * destroy the information rather than control for it — so if you ever turn
   * this off, leave the recording alone.
   *
   * The drawing travels with its option; the colour belongs to the position on
   * screen. Binding colour to content would put the bias straight back in.
   */
  shuffleOptions: true,

  /**
   * The content sets. A wave is what is asked and in what order; which wave a
   * child gets is set per account by the roster tool (app_metadata.wave,
   * absent = 1), never here. A child can go through several waves weeks apart,
   * or start directly in a later one: new children given different content
   * from wave 1 are simply in wave 2. At most three (a database check).
   *
   *   items  the item ids this wave runs: null = every item in items.json.
   *          A wave can repeat items from an earlier one, add new ones, or
   *          both — a repeated item keeps its id, so its answers pair across
   *          waves by (participant, item_id).
   *   order  "shuffle"  a per-participant order, drawn from the participant's
   *                     code so that a reload resumes into the same sequence.
   *                     Safe only because every row records item_position.
   *          "fixed"    exactly the order listed (file order when items is
   *                     null), the same for every participant.
   *
   * Wave 1 is required: every account without a wave is in it.
   *
   * A wave's list does not change once its first class has started — two
   * children "in wave 2" must have been asked the same things. This is a
   * convention, not something the code enforces; see "Vlny" in the README.
   *
   * Ids are not all of the form QNN: the fifteen items whose wording changed
   * on 29.10 carry a _v2 suffix. See "Verzie zadaní" in the README.
   *
   * Example of a later wave:
   *   2: { items: ["Q01_v2", "Q05", "Q26"], order: "shuffle" },
   */
  waves: {
    1: { items: null, order: "shuffle" }
  },

  /**
   * Testing shortcut: keep only the first N items of whichever wave runs, for
   * think-alouds, a timing pilot, or a two-minute logistics test. null = no
   * limit. Must be null for real collection — the completion threshold is
   * pre-registered against a fixed item set (§6.2) — and any short run is
   * announced in the console.
   */
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
    /** Structure only — ids, drawings, order. No words (§13.3). */
    items: "content/items.json",

    /**
     * The login screen, fetched at boot. It is deliberately separate from the
     * locale files: it is rendered before anyone has signed in, so the
     * participant's language is not yet known (§13.4).
     */
    loginStrings: "content/strings.login.json",

    /**
     * Everything after login, including the item text. {locale} is replaced
     * with the session's resolved value — one of cs, sk, en — and a fetch
     * that fails falls back to cs rather than stopping the session (§13.6).
     */
    strings: "content/strings.{locale}.json",

    roster: "content/roster.json",
    /** Built from the source drawings by tools/build-icons.ps1. */
    icons: "assets/icons.svg"
  }
};

