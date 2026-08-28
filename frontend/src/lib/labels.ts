// Words for values the database stores as identifiers.
//
// Three screens were rendering `journey_status` straight out of the column —
// "chronic_management", "follow_up_active" — and one of them only replaced the
// underscores. A patient's own record read like a schema dump. One map, so a fourth
// screen cannot invent a fifth spelling.

export const JOURNEY_WORDS: Record<string, string> = {
  screened: "Screened at camp",
  opd_referred: "Referred to OPD",
  opd_visited: "Seen at OPD",
  ipd_admitted: "Admitted",
  recovery: "Recovering at home",
  follow_up_active: "Follow-up calls running",
  chronic_management: "Long-term care",
  closed: "Closed",
};

export const journeyWords = (v: string | null | undefined) =>
  (v && JOURNEY_WORDS[v]) || (v ? v.replace(/_/g, " ") : "Screened at camp");
