export type TabId = "corpus" | "network" | "compare" | "evidence";

export type CorpusDocument = {
  document_id: string;
  published_at: string;
  year: number;
  month: string;
  channel: string;
  platform: string | null;
  content_type: string | null;
  title: string | null;
  url: string | null;
  event_id: string;
  event_name: string;
  ponzi: boolean;
  kenaikan_biaya: boolean;
  keamanan_dana: boolean;
  keadilan: boolean;
  keberlanjutan: boolean;
  subsidi_silang: boolean;
};

export type EvidenceDocument = CorpusDocument & {
  author: string | null;
  mentioned_actors_raw: string | null;
  document_text: string;
  sentiment: string | null;
  query_sources: string;
  source_id: string | null;
  source_file: string;
  source_sheet: string;
  source_row: number;
  source_locator: string;
  repost_type?: "retweet" | "repost" | "quote_post" | "reused_text" | "original";
  repost_source?: string | null;
};

export type Edge = {
  statement_id: string;
  document_id: string;
  published_at: string;
  year: number;
  channel: string;
  platform: string | null;
  event_id: string;
  event_name: string;
  actor: string;
  actor_normalized?: string;
  concept: string;
  subconcept?: string;
  subconcept_label?: string;
  proposition: string;
  stance: "support" | "oppose";
  sign: number;
  statement_text: string;
  context_text: string;
  url: string | null;
  source_locator: string;
  stance_score: number;
  actor_confidence: string;
  actor_method: string;
  quote_status?: "verbatim_source_excerpt" | "not_found";
  attribution_type?: "account_post" | "reported_statement" | "reported_with_context" | "reposted_content";
  audit_status?: "verified" | "verified_with_limitation" | "needs_review" | "needs_revision";
  audit_note?: string;
  network_included?: boolean;
  repost_type?: "retweet" | "repost" | "quote_post" | "reused_text" | "original";
  repost_source?: string | null;
};

export type EventWindow = {
  event_id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  selection_basis: string;
};

export type MediaActorMention = {
  document_id: string;
  published_at: string;
  year: number;
  event_id: string;
  event_name: string;
  actor: string;
  concepts: string[];
  url: string | null;
  source_locator: string;
};

export type DocumentConcept = {
  document_id: string; concept: string; proposition: string; published_at: string; year: number; event_id: string; channel: string; platform: string; author: string; url: string; title: string; statement_text: string; source_locator: string; stance: "support" | "oppose" | "unclear"; support_score: number; oppose_score: number; neutral_score: number;
  repost_type?: string; repost_source?: string | null;
};

export type SubconceptDefinition = {
  concept: string; subconcept: string; label: string; description: string; proposition?: string;
};

export type StatementSubconcept = {
  statement_id: string; document_id: string; published_at: string; year: number; channel: string; platform: string | null;
  event_id: string; event_name: string; actor: string; concept: string; subconcept: string; subconcept_label: string;
  stance: "support" | "oppose" | "unclear"; statement_text: string; url: string | null; source_locator: string; assignment_score: number;
  parent_concept_stance?: "support" | "oppose"; subconcept_proposition?: string;
  network_included?: boolean; audit_status?: string; audit_note?: string; attribution_type?: string; repost_type?: string; repost_source?: string | null;
};

export type DocumentSubconcept = {
  document_id: string; published_at: string; year: number; channel: string; platform: string | null; event_id: string;
  author: string; concept: string; subconcept: string; subconcept_label: string; stance: "support" | "oppose" | "unclear";
  statement_text: string; url: string | null; source_locator: string; assignment_score: number;
  repost_type?: string; repost_source?: string | null;
};

export type SubconceptNetwork = {
  codebook: SubconceptDefinition[];
  statementEdges: StatementSubconcept[];
  documentEdges: DocumentSubconcept[];
};

/**
 * The corpus, relation and event tables needed for first paint (~4 MB).
 * Everything the Korpus, Perbandingan and Bukti tabs read lives here.
 */
export type Dataset = {
  corpus: CorpusDocument[];
  documentEdges: Edge[];
  statements: Edge[];
  events: EventWindow[];
};

/**
 * Document-level concept assignments and the subconcept network (~11 MB).
 * Only the Jaringan tab reads these, so they load after first paint.
 */
export type NetworkDataset = {
  documentConcepts: DocumentConcept[];
  subconceptNetwork: SubconceptNetwork;
};

export type Filters = {
  startDate: string;
  endDate: string;
  channel: string;
  platform: string;
  eventId: string;
  concept: string;
  stance: string;
  actorQuery: string;
  textQuery: string;
};

export const INITIAL_FILTERS: Filters = {
  startDate: "2021-01-01",
  endDate: "2024-12-31",
  channel: "all",
  platform: "all",
  eventId: "all",
  concept: "all",
  stance: "all",
  actorQuery: "",
  textQuery: "",
};

export const CONCEPT_LABELS: Record<string, string> = {
  ponzi: "Ponzi",
  kenaikan_biaya: "Kenaikan biaya",
  keamanan_dana: "Keamanan dana",
  keadilan: "Keadilan",
  keberlanjutan: "Keberlanjutan",
  subsidi_silang: "Subsidi silang",
};

export const OVERVIEW_CONCEPT_INDICATORS = [
  ["ponzi", "Ponzi"],
  ["kenaikan_biaya", "Kenaikan biaya"],
  ["keamanan_dana", "Keamanan dana"],
  ["keadilan", "Keadilan"],
  ["keberlanjutan", "Keberlanjutan"],
  ["subsidi_silang", "Subsidi silang"],
] as const;

export function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

export function formatChannel(value: string) {
  return value === "media_massa" ? "Media massa" : "Media sosial";
}

const DATE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** `2023-02-01T17:50:48` becomes `1 Feb 2023`, with the clock time kept optional. */
export function formatDate(value: string, withTime = false) {
  const [date, clock] = value.replace("T", " ").split(" ");
  const [year, month, day] = date.split("-");
  const label = `${Number(day)} ${DATE_MONTHS[Number(month) - 1]} ${year}`;
  return withTime && clock ? `${label}, ${clock.slice(0, 5)}` : label;
}

export function displayActorName(actor: string) {
  if (actor === "Ma'Ruf Amin") return "Ma'ruf Amin";
  const account = actor.match(/^(?:twitter|facebook|instagram|youtube|tiktok|video)::(.+)$/i)?.[1];
  if (!account) return actor;
  if (account.toLowerCase() === "bpkhri") return "BPKH RI";
  // A few handles already carry their own "@" in the source sheet.
  return `@${account.replace(/^@+/, "")}`;
}

export function distributionLabel(type?: string, source?: string | null) {
  if (type === "retweet") return source ? `Retweet dari ${source}` : "Retweet";
  if (type === "repost") return source ? `Repost dari ${source}` : "Repost";
  if (type === "quote_post") return "Quote post";
  if (type === "reused_text") return "Teks digunakan ulang";
  return "";
}

export function statementEvidenceLabel(statement: Edge) {
  if (statement.audit_status === "needs_review" || statement.audit_status === "needs_revision") return "Perlu diperiksa";
  if (statement.attribution_type === "account_post") return "Unggahan akun";
  if (statement.attribution_type === "reported_with_context") return "Atribusi dari konteks sumber";
  if (statement.attribution_type === "reposted_content") return "Konten yang dibagikan ulang";
  return "Pernyataan dilaporkan sumber";
}

export const STANCE_LABELS: Record<string, string> = {
  support: "Mendukung",
  oppose: "Menolak",
  unclear: "Belum jelas",
};

/**
 * Short badge plus the sentence a reader needs to judge how far the coded position
 * can be pushed. Most statements are excerpts that attribute a claim rather than
 * verbatim quotations, and the interface has to keep saying so.
 */
export function statementAudit(statement: Edge) {
  if (statement.audit_status === "verified") {
    return { badge: "Terverifikasi", tone: "verified", note: "Kutipan cocok dengan teks sumber." };
  }
  if (statement.audit_status === "needs_review" || statement.audit_status === "needs_revision") {
    return { badge: "Perlu diperiksa", tone: "review", note: statement.audit_note || "Atribusi atau posisi belum divalidasi terhadap teks sumber." };
  }
  const note = statement.attribution_type === "account_post"
    ? "Teks berasal dari unggahan akun itu sendiri."
    : "Teks adalah cuplikan sumber yang mengatribusikan klaim, bukan otomatis kutipan langsung aktor.";
  return { badge: "Terverifikasi dengan catatan", tone: "limited", note: statement.audit_note || note };
}

export function inRange(date: string, filters: Pick<Filters, "startDate" | "endDate">) {
  const day = date.slice(0, 10);
  return day >= filters.startDate && day <= filters.endDate;
}

export function matchesBase(
  row: Pick<Edge, "published_at" | "channel" | "platform" | "event_id">,
  filters: Filters,
) {
  return (
    inRange(row.published_at, filters) &&
    (filters.channel === "all" || row.channel === filters.channel) &&
    (filters.platform === "all" || row.platform === filters.platform) &&
    (filters.eventId === "all" || row.event_id === filters.eventId)
  );
}

export function matchesEdge(edge: Edge, filters: Filters) {
  const actor = (edge.actor_normalized || edge.actor).toLowerCase();
  const text = filters.textQuery.trim().toLowerCase();
  // Free text searches the quote, the assessed proposition and the surrounding context,
  // so a reader can find a statement by wording as well as by actor.
  const matchesText =
    !text ||
    edge.statement_text.toLowerCase().includes(text) ||
    edge.proposition.toLowerCase().includes(text) ||
    (edge.context_text || "").toLowerCase().includes(text);
  return (
    matchesBase(edge, filters) &&
    (filters.concept === "all" || edge.concept === filters.concept) &&
    (filters.stance === "all" || edge.stance === filters.stance) &&
    (!filters.actorQuery || actor.includes(filters.actorQuery.toLowerCase())) &&
    matchesText
  );
}

export function countActiveFilters(filters: Filters) {
  return [
    filters.startDate !== INITIAL_FILTERS.startDate || filters.endDate !== INITIAL_FILTERS.endDate,
    filters.channel !== "all",
    filters.platform !== "all",
    filters.eventId !== "all",
    filters.concept !== "all",
    filters.stance !== "all",
    filters.actorQuery.trim() !== "",
    filters.textQuery.trim() !== "",
  ].filter(Boolean).length;
}
