"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, Download, SlidersHorizontal, X } from "lucide-react";
import { EmptyState, PageLead } from "./page-chrome";
import {
  CONCEPT_LABELS, INITIAL_FILTERS, OVERVIEW_CONCEPT_INDICATORS, STANCE_LABELS,
  countActiveFilters, displayActorName, distributionLabel, formatChannel, formatDate, formatNumber,
  inRange, matchesEdge, statementAudit,
  type Edge, type EventWindow, type EvidenceDocument, type Filters,
} from "./dashboard-model";
import { readUrlParams, writeUrlParams } from "./url-state";
import { SelectField } from "./select-field";

const PAGE_SIZE = 25;

/**
 * The tab carries two units of analysis and they must not be blurred together: a
 * document is a retrieved record, a statement is a coded actor position. Only 240
 * of 6.657 documents carry a coded statement, so the statement list needs its own
 * mode rather than being buried inside document paging.
 */
type EvidenceMode = "documents" | "statements";
type SortKey = "newest" | "oldest" | "statements" | "actor";

const SORT_OPTIONS: Record<EvidenceMode, Array<{ value: SortKey; label: string }>> = {
  documents: [
    { value: "newest", label: "Terbaru dahulu" },
    { value: "oldest", label: "Terlama dahulu" },
    { value: "statements", label: "Posisi terkode terbanyak" },
  ],
  statements: [
    { value: "newest", label: "Terbaru dahulu" },
    { value: "oldest", label: "Terlama dahulu" },
    { value: "actor", label: "Aktor A–Z" },
  ],
};

const URL_KEYS: Record<keyof Filters, string> = {
  startDate: "mulai", endDate: "selesai", channel: "kanal", platform: "media", eventId: "peristiwa",
  concept: "konsep", stance: "posisi", actorQuery: "aktor", textQuery: "cari",
};

const FILTER_FIELDS = Object.keys(URL_KEYS) as Array<keyof Filters>;

/**
 * One coded statement can hold a position on several concepts, so a row in the
 * position list is a statement-concept relation: 320 rows over 291 statements.
 * Only the triple below is unique, and the same key orders the reading sheet.
 */
function relationKey(statement: Edge) {
  return `${statement.statement_id}::${statement.concept}::${statement.proposition}`;
}

/** Seeds the shared filter state in the parent so a cited link opens on the same view. */
export function evidenceFiltersFromUrl(): Filters {
  const params = readUrlParams();
  const next = { ...INITIAL_FILTERS };
  FILTER_FIELDS.forEach((field) => {
    const value = params.get(URL_KEYS[field]);
    if (value !== null) next[field] = value;
  });
  return next;
}

/**
 * An actor query can reach a document through three quite different relations, and
 * they carry very different evidential weight: a coded position is analysed data, a
 * byline is authorship, and a mention comes from the media monitoring sheet's
 * "Influencers" column. The interface has to say which one matched.
 */
type ActorMatch = "statement" | "author" | "mentioned";

const ACTOR_MATCH_LABELS: Record<ActorMatch, string> = {
  statement: "Pernyataan terkode",
  author: "Penulis",
  mentioned: "Disebut",
};

function actorMatchKind(doc: EvidenceDocument, documentStatements: Edge[], query: string): ActorMatch | null {
  const has = (value: unknown) => String(value || "").toLowerCase().includes(query);
  if (documentStatements.some((statement) => has(statement.actor) || has(statement.actor_normalized))) return "statement";
  if (has(doc.author)) return "author";
  if (has(doc.mentioned_actors_raw)) return "mentioned";
  return null;
}

function splitActors(raw: string | null) {
  return (raw || "").split(/[,;|]/).map((name) => name.trim()).filter(Boolean);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, query: string) {
  const term = query.trim();
  if (!term) return 0;
  return (text.match(new RegExp(escapeRegExp(term), "gi")) || []).length;
}

/** Marks every occurrence of the active search term so a reader is not left scanning. */
function Highlight({ text, query }: { text: string; query: string }) {
  const term = query.trim();
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, "gi")).filter((part) => part !== "");
  return <>{parts.map((part, index) => part.toLowerCase() === term.toLowerCase()
    ? <mark key={index}>{part}</mark>
    : <Fragment key={index}>{part}</Fragment>)}</>;
}

/** Media records repeat their headline as the first line of the body text. */
function previewText(doc: EvidenceDocument) {
  const text = (doc.document_text || "").trim();
  const title = (doc.title || "").trim();
  if (title && text.toLowerCase().startsWith(title.toLowerCase())) {
    return text.slice(title.length).replace(/^[\s\-–—|:·]+/, "") || text;
  }
  return text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  // The byte order mark keeps Indonesian characters intact when the file opens in Excel.
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function EvidenceFilters({ mode, filters, setFilters, sort, setSort, events, platforms, resultCount, totalCount, unitLabel, onExport }: {
  mode: EvidenceMode;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  events: EventWindow[];
  platforms: string[];
  resultCount: number;
  totalCount: number;
  unitLabel: string;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const update = (field: keyof Filters, value: string) => setFilters({ ...filters, [field]: value });
  const active = countActiveFilters(filters);
  return (
    <section className={open ? "evidence-filters is-open" : "evidence-filters"} aria-label={`Filter ${unitLabel}`}>
      <div className="evidence-filter-head">
        <span>Filter {unitLabel}</span>
        <div className="evidence-filter-actions">
          <small>{formatNumber(resultCount)} dari {formatNumber(totalCount)} {unitLabel}</small>
          <button type="button" className="ghost-button" onClick={onExport} disabled={resultCount === 0}>
            <Download size={14} aria-hidden="true" />Unduh CSV
          </button>
          <button type="button" className="filter-disclosure" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            {open ? "Tutup filter" : `Filter${active > 0 ? ` (${active})` : ""}`}
          </button>
        </div>
      </div>
      <div className="evidence-filter-controls">
        <label className="wide">Cari teks
          <input type="search" value={filters.textQuery} placeholder={mode === "statements" ? "Kutipan atau proposisi" : "Judul atau isi dokumen"}
            onChange={(event) => update("textQuery", event.target.value)} />
        </label>
        <label>Aktor
          <input type="search" value={filters.actorQuery}
            placeholder={mode === "statements" ? "Aktor pernyataan" : "Aktor terkode, penulis, atau yang disebut"}
            onChange={(event) => update("actorQuery", event.target.value)} />
        </label>
        <SelectField label="Konsep" value={filters.concept} onValueChange={(next) => update("concept", next)}
          options={[{ value: "all", label: "Semua konsep" },
            ...Object.entries(CONCEPT_LABELS).map(([value, label]) => ({ value, label }))]} />
        <SelectField label="Kanal" value={filters.channel} onValueChange={(next) => update("channel", next)}
          options={[{ value: "all", label: "Semua kanal" },
            { value: "media_massa", label: "Media massa" }, { value: "media_sosial", label: "Media sosial" }]} />
        <SelectField label="Media / platform" value={filters.platform} onValueChange={(next) => update("platform", next)}
          options={[{ value: "all", label: "Semua media" },
            ...platforms.map((platform) => ({ value: platform, label: platform }))]} />
        <SelectField label="Peristiwa" value={filters.eventId} onValueChange={(next) => update("eventId", next)}
          options={[{ value: "all", label: "Semua peristiwa" },
            ...events.map((event) => ({ value: event.event_id, label: event.event_name }))]} />
        <SelectField label="Posisi pernyataan" value={filters.stance} onValueChange={(next) => update("stance", next)}
          options={[{ value: "all", label: "Semua posisi" },
            { value: "support", label: "Mendukung" }, { value: "oppose", label: "Menolak" }]} />
        <SelectField label="Urutkan" value={sort} onValueChange={(next) => setSort(next as SortKey)}
          options={SORT_OPTIONS[mode].map((option) => ({ value: option.value, label: option.label }))} />
        <label>Mulai<input type="date" value={filters.startDate} onChange={(event) => update("startDate", event.target.value)} /></label>
        <label>Selesai<input type="date" value={filters.endDate} onChange={(event) => update("endDate", event.target.value)} /></label>
        <button type="button" className="filter-reset" disabled={active === 0} onClick={() => setFilters(INITIAL_FILTERS)}>
          Atur ulang{active > 0 ? ` (${active})` : ""}
        </button>
      </div>
    </section>
  );
}

export function EvidenceTab({ documents, statements, filters, setFilters, events }: {
  documents: EvidenceDocument[];
  statements: Edge[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  events: EventWindow[];
}) {
  // The view is seeded from the query string at mount so a cited link reopens exactly
  // the same document, page and ordering. Afterwards the URL follows the UI.
  const [urlSeed] = useState(readUrlParams);
  const [mode, setMode] = useState<EvidenceMode>(() => urlSeed.get("mode") === "statements" ? "statements" : "documents");
  const [sort, setSort] = useState<SortKey>(() => {
    const seeded = urlSeed.get("urut");
    const seededMode = urlSeed.get("mode") === "statements" ? "statements" : "documents";
    return seeded && SORT_OPTIONS[seededMode].some((option) => option.value === seeded) ? seeded as SortKey : "newest";
  });
  const [page, setPage] = useState(() => {
    const seeded = Number(urlSeed.get("hal"));
    return Number.isFinite(seeded) && seeded > 1 ? Math.round(seeded) - 1 : 0;
  });
  // Null means "show the real page number"; a string is the reader's unconfirmed input.
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(() => urlSeed.get("dok") || "");
  // Holds a relation key after a click, or the bare statement id seeded from a link.
  const [selectedStatementId, setSelectedStatementId] = useState(() => urlSeed.get("pernyataan") || "");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  const isStatementMode = mode === "statements";
  const term = filters.textQuery.trim();

  const statementsByDocument = useMemo(() => {
    const index = new Map<string, Edge[]>();
    statements.forEach((statement) => index.set(statement.document_id, [...(index.get(statement.document_id) || []), statement]));
    return index;
  }, [statements]);
  const documentsById = useMemo(() => new Map(documents.map((doc) => [doc.document_id, doc])), [documents]);
  const platforms = useMemo(() => Array.from(new Set(documents.map((doc) => doc.platform)
    .filter((value): value is string => value !== null && value !== ""))).sort(), [documents]);

  const actorQuery = filters.actorQuery.trim().toLowerCase();
  const filteredDocuments = useMemo(() => documents.filter((doc) => {
    if (!inRange(doc.published_at, filters)) return false;
    if (filters.channel !== "all" && doc.channel !== filters.channel) return false;
    if (filters.platform !== "all" && doc.platform !== filters.platform) return false;
    if (filters.eventId !== "all" && doc.event_id !== filters.eventId) return false;
    if (filters.concept !== "all" && !(doc as unknown as Record<string, unknown>)[filters.concept]) return false;
    const documentStatements = statementsByDocument.get(doc.document_id) || [];
    if (filters.stance !== "all" && !documentStatements.some((statement) => statement.stance === filters.stance)) return false;
    if (actorQuery && !actorMatchKind(doc, documentStatements, actorQuery)) return false;
    return !term || [doc.title, doc.document_text, ...documentStatements.flatMap((statement) => [statement.statement_text, statement.proposition])]
      .some((value) => String(value || "").toLowerCase().includes(term.toLowerCase()));
  }), [documents, filters, statementsByDocument, term, actorQuery]);

  const actorBreakdown = useMemo(() => {
    if (!actorQuery) return null;
    const tally: Record<ActorMatch, number> = { statement: 0, author: 0, mentioned: 0 };
    filteredDocuments.forEach((doc) => {
      const kind = actorMatchKind(doc, statementsByDocument.get(doc.document_id) || [], actorQuery);
      if (kind) tally[kind] += 1;
    });
    return tally;
  }, [filteredDocuments, statementsByDocument, actorQuery]);

  const filteredStatements = useMemo(() => statements.filter((statement) => matchesEdge(statement, filters)), [statements, filters]);

  const sortedDocuments = useMemo(() => {
    const rows = [...filteredDocuments];
    if (sort === "oldest") return rows.sort((a, b) => a.published_at.localeCompare(b.published_at));
    if (sort === "statements") return rows.sort((a, b) =>
      (statementsByDocument.get(b.document_id)?.length || 0) - (statementsByDocument.get(a.document_id)?.length || 0)
      || b.published_at.localeCompare(a.published_at));
    return rows.sort((a, b) => b.published_at.localeCompare(a.published_at));
  }, [filteredDocuments, sort, statementsByDocument]);

  const sortedStatements = useMemo(() => {
    const rows = [...filteredStatements];
    if (sort === "oldest") return rows.sort((a, b) => a.published_at.localeCompare(b.published_at));
    if (sort === "actor") return rows.sort((a, b) =>
      displayActorName(a.actor_normalized || a.actor).localeCompare(displayActorName(b.actor_normalized || b.actor))
      || b.published_at.localeCompare(a.published_at));
    return rows.sort((a, b) => b.published_at.localeCompare(a.published_at));
  }, [filteredStatements, sort]);

  const resultCount = isStatementMode ? sortedStatements.length : sortedDocuments.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const offset = safePage * PAGE_SIZE;
  const visibleDocuments = sortedDocuments.slice(offset, offset + PAGE_SIZE);
  const visibleStatements = sortedStatements.slice(offset, offset + PAGE_SIZE);

  const selectedStatement = isStatementMode
    ? sortedStatements.find((statement) => relationKey(statement) === selectedStatementId)
      || sortedStatements.find((statement) => statement.statement_id === selectedStatementId)
      || visibleStatements[0]
    : undefined;
  const selected = isStatementMode
    ? (selectedStatement && documentsById.get(selectedStatement.document_id))
    : (sortedDocuments.find((doc) => doc.document_id === selectedDocumentId) || visibleDocuments[0]);
  const selectedStatements = selected ? statementsByDocument.get(selected.document_id) || [] : [];
  const selectedConcepts = selected ? OVERVIEW_CONCEPT_INDICATORS.filter(([concept]) => selected[concept]).map(([, label]) => label) : [];
  const textMatches = selected ? countMatches(selected.document_text || "", term) : 0;

  useEffect(() => {
    writeUrlParams({
      tab: "evidence",
      mode: isStatementMode ? "statements" : null,
      urut: sort === "newest" ? null : sort,
      hal: safePage > 0 ? String(safePage + 1) : null,
      dok: isStatementMode ? null : selectedDocumentId || null,
      pernyataan: isStatementMode && selectedStatementId ? selectedStatement?.statement_id || null : null,
      ...Object.fromEntries(FILTER_FIELDS.map((field) =>
        [URL_KEYS[field], filters[field] === INITIAL_FILTERS[field] ? null : filters[field]])),
    });
  }, [isStatementMode, sort, safePage, selectedDocumentId, selectedStatementId, selectedStatement, filters]);

  // Bring the first hit into view inside the document text box without moving the page.
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;
    const mark = container.querySelector("mark");
    container.scrollTop = mark ? Math.max((mark as HTMLElement).offsetTop - 48, 0) : 0;
  }, [selected?.document_id, term]);

  const clearSelection = () => { setSelectedDocumentId(""); setSelectedStatementId(""); };
  const applyFilters = (next: Filters) => { setFilters(next); setPage(0); clearSelection(); };
  const turnPage = (next: number) => {
    setPage(Math.max(0, Math.min(next, pageCount - 1)));
    setPageDraft(null);
    clearSelection();
    listRef.current?.scrollTo({ top: 0 });
  };
  const changeMode = (next: EvidenceMode) => {
    if (next === mode) return;
    setMode(next);
    setPage(0);
    clearSelection();
    if (!SORT_OPTIONS[next].some((option) => option.value === sort)) setSort("newest");
  };
  const commitPageInput = () => {
    const value = Number(pageDraft);
    if (pageDraft !== null && Number.isFinite(value) && value >= 1) turnPage(Math.min(Math.round(value), pageCount) - 1);
    else setPageDraft(null);
  };
  const copyLocator = (value: string) => {
    navigator.clipboard?.writeText(value)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })
      .catch(() => undefined);
  };

  // Arrow keys walk the index the way a list in a reference manager does.
  const onItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(listRef.current?.querySelectorAll("button") || []);
    const index = buttons.indexOf(event.currentTarget);
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  };

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (isStatementMode) {
      downloadCsv(`posisi-terkode-${stamp}.csv`, [
        ["statement_id", "document_id", "published_at", "actor", "concept", "proposition", "stance",
          "statement_text", "channel", "platform", "event_name", "url", "source_locator", "audit_status"],
        ...sortedStatements.map((statement) => [statement.statement_id, statement.document_id, statement.published_at,
          statement.actor_normalized || statement.actor, statement.concept, statement.proposition, statement.stance,
          statement.statement_text, statement.channel, statement.platform, statement.event_name, statement.url,
          statement.source_locator, statement.audit_status]),
      ]);
      return;
    }
    downloadCsv(`dokumen-korpus-${stamp}.csv`, [
      ["document_id", "published_at", "channel", "platform", "author", "title", "url", "event_name",
        "query_sources", "source_locator", "jumlah_posisi_terkode",
        ...OVERVIEW_CONCEPT_INDICATORS.map(([concept]) => `indikator_${concept}`)],
      ...sortedDocuments.map((doc) => [doc.document_id, doc.published_at, doc.channel, doc.platform, doc.author,
        doc.title, doc.url, doc.event_name, doc.query_sources, doc.source_locator,
        statementsByDocument.get(doc.document_id)?.length || 0,
        ...OVERVIEW_CONCEPT_INDICATORS.map(([concept]) => (doc[concept] ? 1 : 0))]),
    ]);
  };

  const chips: Array<{ key: string; label: string; patch: Partial<Filters> }> = [];
  if (term) chips.push({ key: "cari", label: `Teks: ${term}`, patch: { textQuery: "" } });
  if (filters.actorQuery.trim()) chips.push({ key: "aktor", label: `Aktor: ${filters.actorQuery.trim()}`, patch: { actorQuery: "" } });
  if (filters.concept !== "all") chips.push({ key: "konsep", label: `Konsep: ${CONCEPT_LABELS[filters.concept] || filters.concept}`, patch: { concept: "all" } });
  if (filters.channel !== "all") chips.push({ key: "kanal", label: formatChannel(filters.channel), patch: { channel: "all" } });
  if (filters.platform !== "all") chips.push({ key: "media", label: filters.platform, patch: { platform: "all" } });
  if (filters.eventId !== "all") {
    chips.push({ key: "peristiwa", label: events.find((event) => event.event_id === filters.eventId)?.event_name || filters.eventId, patch: { eventId: "all" } });
  }
  if (filters.stance !== "all") chips.push({ key: "posisi", label: `Posisi: ${STANCE_LABELS[filters.stance]}`, patch: { stance: "all" } });
  if (filters.startDate !== INITIAL_FILTERS.startDate || filters.endDate !== INITIAL_FILTERS.endDate) {
    chips.push({
      key: "periode",
      label: `${formatDate(filters.startDate)} – ${formatDate(filters.endDate)}`,
      patch: { startDate: INITIAL_FILTERS.startDate, endDate: INITIAL_FILTERS.endDate },
    });
  }

  const codedDocumentCount = statementsByDocument.size;
  const codedStatementCount = new Set(statements.map((statement) => statement.statement_id)).size;
  const codedShare = (100 * codedDocumentCount / documents.length).toLocaleString("id-ID", { maximumFractionDigits: 1 });
  const unitLabel = isStatementMode ? "posisi terkode" : "dokumen";

  return <>
    <PageLead tab="evidence" title="Pernyataan dan bukti">
      Basis data dokumen 2021–2024 beserta teks, konsep, provenance, dan pernyataan aktor.
    </PageLead>

    <section className="evidence-modes" aria-label="Unit yang ditampilkan">
      <div className="evidence-mode-switch" role="group" aria-label="Unit analisis">
        <button type="button" aria-pressed={!isStatementMode} onClick={() => changeMode("documents")}>
          Dokumen<span>{formatNumber(documents.length)}</span>
        </button>
        <button type="button" aria-pressed={isStatementMode} onClick={() => changeMode("statements")}>
          Posisi terkode<span>{formatNumber(statements.length)}</span>
        </button>
      </div>
      <p className="evidence-coverage">
        {formatNumber(statements.length)} posisi terkode berasal dari {formatNumber(codedStatementCount)} pernyataan
        dalam {formatNumber(codedDocumentCount)} dokumen, atau {codedShare} persen dari {formatNumber(documents.length)} dokumen
        unik. Satu pernyataan dapat memuat posisi pada lebih dari satu konsep. Dokumen lain tetap tersedia sebagai konteks
        korpus dan belum memiliki posisi terkode.
      </p>
    </section>

    <EvidenceFilters
      mode={mode} filters={filters} setFilters={applyFilters} sort={sort}
      setSort={(next) => { setSort(next); setPage(0); clearSelection(); }}
      events={events} platforms={platforms} resultCount={resultCount}
      totalCount={isStatementMode ? statements.length : documents.length}
      unitLabel={unitLabel} onExport={exportCsv}
    />

    {chips.length > 0 && <div className="filter-chips">
      <span>Filter aktif</span>
      {chips.map((chip) => (
        <button key={chip.key} type="button" onClick={() => applyFilters({ ...filters, ...chip.patch })}>
          {chip.label}<X size={12} aria-hidden="true" /><span className="sr-only">Hapus filter</span>
        </button>
      ))}
      <button type="button" className="filter-chips-reset" onClick={() => applyFilters(INITIAL_FILTERS)}>Hapus semua</button>
    </div>}

    {actorBreakdown && !isStatementMode && resultCount > 0 && <p className="match-breakdown">
      {formatNumber(resultCount)} dokumen cocok dengan nama ini:{" "}
      {formatNumber(actorBreakdown.statement)} memuat pernyataan terkode aktor tersebut,{" "}
      {formatNumber(actorBreakdown.author)} ditulis olehnya, dan{" "}
      {formatNumber(actorBreakdown.mentioned)} hanya menyebut namanya pada metadata pemantauan media.
      Penyebutan bukan posisi terkode.
    </p>}

    {resultCount === 0
      ? <EmptyState>Ubah filter untuk menampilkan {unitLabel}.</EmptyState>
      : <section className="archive-room document-archive">
          <article className="archive-index">
            <header>
              <span>INDEKS / {formatNumber(resultCount)} {isStatementMode ? "POSISI" : "DOKUMEN"}</span>
              <h2>{isStatementMode ? "Posisi terkode" : "Dokumen korpus"}</h2>
              <p>Menampilkan {formatNumber(offset + 1)}–{formatNumber(offset + (isStatementMode ? visibleStatements.length : visibleDocuments.length))} sesuai filter.</p>
            </header>
            <div className="statement-list document-list" ref={listRef}>
              {isStatementMode
                ? visibleStatements.map((statement, index) => (
                    <button key={relationKey(statement)}
                      className={selectedStatement && relationKey(selectedStatement) === relationKey(statement) ? "selected" : ""}
                      onKeyDown={onItemKeyDown} onClick={() => setSelectedStatementId(relationKey(statement))}>
                      <span className="record-number">{String(offset + index + 1).padStart(4, "0")}</span>
                      <span className={`stance-mark ${statement.stance}`} aria-hidden="true">{statement.stance === "support" ? "+" : "−"}</span>
                      <strong><Highlight text={displayActorName(statement.actor_normalized || statement.actor)} query={term} /></strong>
                      <em>{CONCEPT_LABELS[statement.concept] || statement.concept}</em>
                      <p><Highlight text={statement.statement_text} query={term} /></p>
                      <small>{formatDate(statement.published_at)} / {formatChannel(statement.channel)} / {statement.platform || "—"}</small>
                    </button>
                  ))
                : visibleDocuments.map((doc, index) => {
                    const concepts = OVERVIEW_CONCEPT_INDICATORS.filter(([concept]) => doc[concept]).map(([, label]) => label);
                    const codedCount = statementsByDocument.get(doc.document_id)?.length || 0;
                    const distribution = distributionLabel(doc.repost_type, doc.repost_source);
                    const match = actorQuery ? actorMatchKind(doc, statementsByDocument.get(doc.document_id) || [], actorQuery) : null;
                    return <button key={doc.document_id}
                      className={selected?.document_id === doc.document_id ? "selected" : ""}
                      onKeyDown={onItemKeyDown} onClick={() => setSelectedDocumentId(doc.document_id)}>
                      <span className="record-number">{String(offset + index + 1).padStart(4, "0")}</span>
                      <span className={`document-channel-mark ${doc.channel}`} aria-hidden="true" />
                      <strong><Highlight text={doc.title || doc.author || "Dokumen tanpa judul"} query={term} /></strong>
                      <em>{concepts.join(" · ") || "Tanpa indikator konsep"}</em>
                      {(match || codedCount > 0 || distribution) && <span className="card-badges">
                        {match && <span className={`match-kind-badge match-${match}`}>{ACTOR_MATCH_LABELS[match]}</span>}
                        {codedCount > 0 && <span className="statement-count-badge">{codedCount} posisi terkode</span>}
                        {distribution && <span className={`distribution-badge ${doc.repost_type}`}>{distribution}</span>}
                      </span>}
                      <p><Highlight text={previewText(doc)} query={term} /></p>
                      <small>{formatDate(doc.published_at)} / {formatChannel(doc.channel)} / {doc.platform || "—"}</small>
                    </button>;
                  })}
            </div>
            <nav className="pagination" aria-label={`Halaman ${unitLabel}`}>
              <button type="button" disabled={safePage === 0} onClick={() => turnPage(safePage - 1)}>
                <ChevronLeft size={14} aria-hidden="true" />Sebelumnya
              </button>
              <label className="pagination-jump">
                Halaman
                <input type="number" min={1} max={pageCount} value={pageDraft ?? String(safePage + 1)} inputMode="numeric"
                  onChange={(event) => setPageDraft(event.target.value)}
                  onBlur={commitPageInput}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitPageInput(); } }} />
                dari {formatNumber(pageCount)}
              </label>
              <button type="button" disabled={safePage >= pageCount - 1} onClick={() => turnPage(safePage + 1)}>
                Berikutnya<ChevronRight size={14} aria-hidden="true" />
              </button>
            </nav>
          </article>

          {selected && <aside className="reading-sheet document-reading-sheet">
            <div className="sheet-running-head"><span>DOKUMEN SUMBER</span><span>{selected.document_id}</span></div>
            <div className="reading-meta">
              <span>{formatChannel(selected.channel)}</span>
              {selected.platform && <span>{selected.platform}</span>}
              <span>{selected.author ? displayActorName(selected.author) : "Penulis tidak tersedia"}</span>
              {distributionLabel(selected.repost_type, selected.repost_source) && (
                <span className={`distribution-badge ${selected.repost_type}`}>{distributionLabel(selected.repost_type, selected.repost_source)}</span>
              )}
            </div>
            <h2>{selected.title || (selected.author && displayActorName(selected.author)) || "Dokumen tanpa judul"}</h2>

            <p className="context-label">Indikator istilah <span className="unit-hint">pemicu leksikal, bukan posisi aktor</span></p>
            <div className="document-concepts">
              {selectedConcepts.length > 0
                ? selectedConcepts.map((concept) => <span key={concept}>{concept}</span>)
                : <span className="is-empty">Tidak ada pemicu istilah</span>}
            </div>

            {selected.mentioned_actors_raw && <>
              <p className="context-label">Aktor disebut <span className="unit-hint">metadata pemantauan media, bukan posisi terkode</span></p>
              <div className="mentioned-actors">
                {splitActors(selected.mentioned_actors_raw).map((name) => (
                  <span key={name} className={actorQuery && name.toLowerCase().includes(actorQuery) ? "is-match" : ""}>{name}</span>
                ))}
              </div>
            </>}

            <p className="context-label">
              Teks dokumen
              {textMatches > 0 && <span className="match-count">{formatNumber(textMatches)} kemunculan “{term}”</span>}
            </p>
            <p className="document-full-text" ref={textRef}><Highlight text={selected.document_text} query={term} /></p>

            <section className="document-coded-statements">
              <span>Posisi terkode · {formatNumber(selectedStatements.length)} relasi pernyataan–konsep</span>
              {selectedStatements.length === 0
                ? <p className="coded-empty">Dokumen ini belum memiliki posisi terkode. Indikator istilah di atas menandai kemunculan kata, bukan posisi aktor.</p>
                : selectedStatements.map((statement) => {
                    const audit = statementAudit(statement);
                    const isCurrent = isStatementMode && !!selectedStatement && relationKey(statement) === relationKey(selectedStatement);
                    return <article key={relationKey(statement)}
                      className={isCurrent ? "is-current" : ""} aria-current={isCurrent || undefined}>
                      <div>
                        <strong>{displayActorName(statement.actor_normalized || statement.actor)}</strong>
                        <span className={`stance-tag ${statement.stance}`}>{STANCE_LABELS[statement.stance] || statement.stance}</span>
                      </div>
                      <small>{CONCEPT_LABELS[statement.concept] || statement.concept} · {statement.proposition}</small>
                      <blockquote><Highlight text={statement.statement_text} query={term} /></blockquote>
                      <p className={`audit-note audit-${audit.tone}`}><span>{audit.badge}</span>{audit.note}</p>
                    </article>;
                  })}
            </section>

            <dl>
              <div><dt>Tanggal</dt><dd>{formatDate(selected.published_at, true)}</dd></div>
              <div><dt>Peristiwa</dt><dd>{selected.event_name || "Di luar event window"}</dd></div>
              {selected.query_sources && <div><dt>Query asal</dt><dd>{selected.query_sources}</dd></div>}
              {selected.source_id && <div><dt>Source ID</dt><dd>{selected.source_id}</dd></div>}
              <div><dt>Locator</dt><dd className="locator-cell">
                <code>{selected.source_locator}</code>
                <button type="button" className="ghost-button" onClick={() => copyLocator(selected.source_locator)}>
                  {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  {copied ? "Tersalin" : "Salin"}
                </button>
              </dd></div>
            </dl>

            {selected.url && <a href={selected.url} target="_blank" rel="noreferrer">Buka sumber asli <ArrowUpRight size={16} aria-hidden="true" /></a>}
          </aside>}
        </section>}
  </>;
}

export function EvidencePending({ failed }: { failed: boolean }) {
  return <>
    <PageLead tab="evidence" title="Pernyataan dan bukti">Basis data seluruh dokumen dalam korpus 2021–2024.</PageLead>
    <div className="empty-state">
      <span>{failed ? "!" : "◍"}</span>
      <strong>{failed ? "Basis data dokumen gagal dimuat" : "Memuat basis data dokumen"}</strong>
      <p>{failed ? "Periksa documents.json pada public/data." : "Teks dan provenance 6.657 dokumen sedang dimuat."}</p>
    </div>
  </>;
}
