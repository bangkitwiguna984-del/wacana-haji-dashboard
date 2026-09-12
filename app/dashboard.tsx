"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import ReactECharts from "echarts-for-react";
import { ConceptCentrality, NetworkTables } from "./network-tables";
import {
  ArrowLeft, ArrowUpRight, BarChart3, BookOpenText, Database,
  Network, PanelLeftClose, PanelLeftOpen, Pause, Play,
} from "lucide-react";
import {
  CONCEPT_LABELS, OVERVIEW_CONCEPT_INDICATORS, displayActorName, distributionLabel,
  formatChannel, formatNumber, inRange, statementEvidenceLabel,
  type DocumentConcept, type DocumentSubconcept, type CorpusDocument, type Dataset, type Edge, type EventWindow, type EvidenceDocument,
  type NetworkDataset, type StatementSubconcept, type SubconceptDefinition, type SubconceptNetwork,
  type Filters, type TabId,
} from "./dashboard-model";
import { EmptyState, PAGE_META, PageLead } from "./page-chrome";
import { EvidencePending, EvidenceTab, evidenceFiltersFromUrl } from "./evidence-tab";
import { readUrlParams, writeUrlParams } from "./url-state";
import { SelectField } from "./select-field";
import { FigureActions } from "./figure-actions";

const TABS = [
  { id: "corpus", label: "Korpus & Waktu", icon: Database },
  { id: "network", label: "Jaringan Wacana", icon: Network },
  { id: "compare", label: "Perbandingan", icon: BarChart3 },
  { id: "evidence", label: "Pernyataan & Bukti", icon: BookOpenText },
] as const;

type OverviewFilters = Pick<Filters, "startDate" | "endDate" | "channel">;
type TimeGranularity = "year" | "month" | "day";

type OverviewState = OverviewFilters & { granularity: TimeGranularity };

const INITIAL_OVERVIEW_FILTERS: OverviewState = {
  startDate: "2021-01-01",
  endDate: "2024-12-31",
  channel: "all",
  granularity: "month",
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const PLATFORM_GROUPS = [
  { key: "media_berita", label: "Media berita", color: "#263f60" },
  { key: "twitter", label: "X / Twitter", color: "#2554a3" },
  { key: "facebook", label: "Facebook", color: "#3c8ca8" },
  { key: "youtube", label: "YouTube", color: "#c34e3f" },
  { key: "instagram", label: "Instagram", color: "#a5668b" },
  { key: "tiktok", label: "TikTok", color: "#675f87" },
  { key: "video", label: "Video lain", color: "#857556" },
  { key: "lainnya", label: "Lainnya", color: "#c2b9a9" },
] as const;

/** Dokumen minimum agar subkonsep tanpa pernyataan terkode tetap digambar. */
const MIN_FACET_DOCUMENTS = 5;

const MAIN_NETWORK_ACTORS = new Set([
  "Kementerian Agama",
  "Yaqut Cholil Qoumas",
  "Asep Saipudin Jahar",
  "Mustolih Siradj",
  "MUI",
  "Ace Hasan Syadzily",
  "Saleh Partaonan Daulay",
  "Acep Riana Jayaprawira",
  "Fadlul Imansyah",
  "Ma'Ruf Amin",
  "Anggito Abimanyu",
  "Bukhori Yusuf",
  "DPR",
  "twitter::BL4rrrrr",
  "twitter::BPKHRI",
]);

function actorName(edge: Pick<Edge, "actor" | "actor_normalized">) {
  return edge.actor_normalized || edge.actor;
}

function platformGroup(row: CorpusDocument) {
  if (row.channel === "media_massa") return "media_berita";
  if (["twitter", "facebook", "youtube", "instagram", "tiktok", "video"].includes(row.platform || "")) return row.platform || "lainnya";
  return "lainnya";
}

function bucketFor(date: string, granularity: TimeGranularity) {
  if (granularity === "year") return date.slice(0, 4);
  if (granularity === "month") return date.slice(0, 7);
  return date.slice(0, 10);
}

function buildTimeBuckets(startDate: string, endDate: string, granularity: TimeGranularity) {
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const buckets: string[] = [];

  if (granularity === "year") cursor.setUTCMonth(0, 1);
  if (granularity === "month") cursor.setUTCDate(1);

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");
    buckets.push(granularity === "year" ? String(year) : granularity === "month" ? `${year}-${month}` : `${year}-${month}-${day}`);

    if (granularity === "year") cursor.setUTCFullYear(year + 1);
    else if (granularity === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return buckets;
}

function formatBucket(bucket: string, granularity: TimeGranularity) {
  if (granularity === "year") return bucket;
  const [year, month, day] = bucket.split("-");
  const monthLabel = MONTH_LABELS[Number(month) - 1];
  return granularity === "month" ? `${monthLabel} ${year.slice(2)}` : `${day} ${monthLabel}`;
}

function formatDateRange(startDate: string, endDate: string) {
  const formatDate = (date: string) => {
    const [year, month, day] = date.split("-");
    return `${Number(day)} ${MONTH_LABELS[Number(month) - 1]} ${year}`;
  };
  return `${formatDate(startDate)}–${formatDate(endDate)}`;
}

type SeriesTooltipItem = { seriesName: string; value: number; marker: string };

function seriesTooltip(title: string, items: SeriesTooltipItem[]) {
  const rows = items
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .map((item) => `${item.marker}${item.seriesName}: ${formatNumber(item.value)}`);
  return [`<strong>${title}</strong>`, ...rows].join("<br/>");
}

function Sidebar({ tab, setTab, collapsed, onToggle }: {
  tab: TabId;
  setTab: (tab: TabId) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside className={collapsed ? "sidebar is-collapsed" : "sidebar"} aria-label="Navigasi dashboard">
      <div className="sidebar-head">
        <div className="brand-block">
          <span className="brand-code">Dashboard riset</span>
          <strong>Wacana Haji</strong>
          <span className="brand-period">Indonesia · 2021–2024</span>
        </div>
        {/* Tombol lipat tetap di posisi yang sama pada kedua keadaan, agar tidak berpindah. */}
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Tampilkan menu samping" : "Sembunyikan menu samping"}
          title={collapsed ? "Tampilkan menu" : "Sembunyikan menu"}
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
        </button>
      </div>

      <nav aria-label="Navigasi utama">
        {TABS.map(({ id, label, icon: Icon }, index) => {
          const folio = String(index + 1).padStart(2, "0");
          return (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              className={tab === id ? "nav-item active" : "nav-item"}
              title={collapsed ? `${folio} · ${label}` : undefined}
              onClick={() => setTab(id)}
            >
              <span className="nav-icon"><Icon size={18} aria-hidden="true" /></span>
              {/* Label tetap ada di DOM saat terlipat agar pembaca layar tidak kehilangan nama tab. */}
              <span className="nav-label">{label}</span>
              <span className="nav-folio" aria-hidden="true">{folio}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-logo">
          {/* The local static asset is intentionally rendered at its native aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpkh-logo.png" alt="Badan Pengelola Keuangan Haji" />
        </div>
      </div>
    </aside>
  );
}

function OverviewFiltersBar({ filters, setFilters }: {
  filters: OverviewState;
  setFilters: (filters: OverviewState) => void;
}) {
  const update = (field: keyof OverviewState, value: string) => setFilters({ ...filters, [field]: value });
  return (
    <section className="overview-filters" aria-label="Filter korpus">
      <div><span>Filter korpus</span><small>Periode dan kanal</small></div>
      <div className="overview-filter-controls">
        <label>Mulai<input type="date" value={filters.startDate} onChange={(event) => update("startDate", event.target.value)} /></label>
        <label>Selesai<input type="date" value={filters.endDate} onChange={(event) => update("endDate", event.target.value)} /></label>
        <SelectField label="Kanal" value={filters.channel} onValueChange={(next) => update("channel", next)}
          options={[{ value: "all", label: "Semua kanal" },
            { value: "media_massa", label: "Media massa" }, { value: "media_sosial", label: "Media sosial" }]} />
      </div>
    </section>
  );
}

function StatLedger({ items }: { items: Array<{ label: string; value: number; note: string; accent?: string }> }) {
  return (
    <section className="stat-ledger" aria-label="Ringkasan data">
      {items.map((item, index) => (
        <article key={item.label} style={{ "--accent": item.accent || "var(--signal)" } as React.CSSProperties}>
          <span className="stat-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="stat-label">{item.label}</span><strong>{formatNumber(item.value)}</strong><small>{item.note}</small>
        </article>
      ))}
    </section>
  );
}

function CorpusTab({ corpus, edges, events, filters, setFilters }: {
  corpus: CorpusDocument[];
  edges: Edge[];
  events: EventWindow[];
  filters: OverviewState;
  setFilters: (filters: OverviewState) => void;
}) {
  const trendRef = useRef<HTMLElement | null>(null);
  const termRef = useRef<HTMLElement | null>(null);
  const platformRef = useRef<HTMLElement | null>(null);
  const conceptRef = useRef<HTMLElement | null>(null);
  const [platformGranularity, setPlatformGranularity] = useState<TimeGranularity>("year");
  const [conceptGranularity, setConceptGranularity] = useState<TimeGranularity>("year");
  const buckets = useMemo(() => buildTimeBuckets(filters.startDate, filters.endDate, filters.granularity), [filters.endDate, filters.granularity, filters.startDate]);
  const countsByChannel = useMemo(() => {
    const counts = new Map<string, number>();
    corpus.forEach((row) => {
      const bucket = bucketFor(row.published_at, filters.granularity);
      const key = `${row.channel}:${bucket}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [corpus, filters.granularity]);
  const networkDocuments = new Set(edges.map((edge) => edge.document_id));
  const peak = buckets.map((bucket) => ({ bucket, count: ["media_massa", "media_sosial"].reduce((total, channel) => total + (countsByChannel.get(`${channel}:${bucket}`) || 0), 0) })).sort((a, b) => b.count - a.count)[0];
  const visibleEvents = events;
  const channelSeries = useMemo(
    () => filters.channel === "all" ? ["media_massa", "media_sosial"] : [filters.channel],
    [filters.channel],
  );
  const unitLabel = { year: "tahun", month: "bulan", day: "hari" }[filters.granularity];
  const showDailyNavigator = filters.granularity === "day" && buckets.length > 120;
  const trendOption = useMemo(() => ({
    animation: true,
    animationDuration: 520,
    animationDurationUpdate: 420,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    aria: { enabled: true, description: `Jumlah dokumen media massa dan media sosial per ${unitLabel}.` },
    color: ["#3f5f8a", "#a86b58"], tooltip: { trigger: "axis", formatter: (items: Array<SeriesTooltipItem & { axisValue: string }>) => seriesTooltip(formatBucket(items[0]?.axisValue || "", filters.granularity), items) },
    legend: { type: "scroll", top: 6, left: 0, right: 0, itemWidth: 14, itemHeight: 10, textStyle: { color: "#555e6a", fontSize: 9 } },
    grid: { left: 48, right: 22, top: 48, bottom: 28 },
    xAxis: { type: "category", data: buckets, boundaryGap: false, axisLine: { lineStyle: { color: "#8f918f" } }, axisTick: { show: false }, axisLabel: { color: "#646b78", hideOverlap: true, interval: "auto", formatter: (value: string) => formatBucket(value, filters.granularity) } },
    yAxis: { type: "value", axisLabel: { color: "#646b78" }, splitLine: { lineStyle: { color: "#dedbd1" } } },
    dataZoom: showDailyNavigator ? [{ type: "inside" }] : [],
    series: channelSeries.map((channel) => ({
      name: formatChannel(channel), type: "line", symbol: channel === "media_massa" ? "rect" : "circle", symbolSize: 5, lineStyle: { width: 2.5, type: channel === "media_massa" ? "dashed" : "solid" }, universalTransition: { enabled: true },
      data: buckets.map((bucket) => countsByChannel.get(`${channel}:${bucket}`) || 0),
    })),
  }), [buckets, channelSeries, countsByChannel, filters.granularity, showDailyNavigator, unitLabel]);
  const termOption = useMemo(() => {
    const data = OVERVIEW_CONCEPT_INDICATORS.map(([field, label]) => ({ label, value: corpus.filter((row) => row[field]).length })).sort((a, b) => a.value - b.value);
    const axisMaximum = Math.ceil(Math.max(...data.map((item) => item.value), 1) / 2000) * 2000;
    return {
      animation: true, animationDuration: 480, animationDurationUpdate: 380, animationEasing: "cubicOut", animationEasingUpdate: "cubicOut",
      aria: { enabled: true, description: "Jumlah dokumen dengan indikator tekstual untuk setiap konsep." }, tooltip: { trigger: "axis" },
      // Nilai tertinggi hampir menyentuh batas sumbu, jadi sisi kanan harus memuat labelnya.
      grid: { left: 116, right: 62, top: 18, bottom: 34 },
      xAxis: {
        type: "value", min: 0, max: axisMaximum, interval: 2000,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: "#68707b", margin: 12, formatter: (value: number) => value === 0 ? "0" : `${value / 1000} rb` },
        splitLine: { lineStyle: { color: "#dedbd1" } },
      },
      yAxis: { type: "category", data: data.map((item) => item.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#4f5660", fontSize: 11, margin: 14 } },
      series: [{
        type: "bar", data: data.map((item) => item.value), barWidth: 34, showBackground: true,
        backgroundStyle: { color: "rgba(138,127,109,.09)", borderRadius: [0, 2, 2, 0] },
        itemStyle: { color: "#8a7f6d", borderRadius: [0, 2, 2, 0] },
        label: { show: true, position: "right", color: "#15181e", fontSize: 11, fontWeight: 650, formatter: ({ value }: { value: number }) => formatNumber(value) },
        universalTransition: { enabled: true },
      }],
    };
  }, [corpus]);
  const platformOption = useMemo(() => {
    const platformBuckets = buildTimeBuckets(filters.startDate, filters.endDate, platformGranularity);
    const counts = new Map<string, number>();
    corpus.forEach((row) => {
      const key = `${bucketFor(row.published_at, platformGranularity)}:${platformGroup(row)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const activeGroups = PLATFORM_GROUPS.filter((group) => platformBuckets.some((bucket) => (counts.get(`${bucket}:${group.key}`) || 0) > 0));
    const showNavigator = platformGranularity === "day" && platformBuckets.length > 120;
    return {
      animation: true, animationDuration: 360, animationDurationUpdate: 260, animationEasing: "quadraticOut", animationEasingUpdate: "quadraticOut",
      aria: { enabled: true, description: `Jumlah dokumen menurut kanal dan platform per ${platformGranularity}.` },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (items: Array<SeriesTooltipItem & { axisValue: string }>) => seriesTooltip(formatBucket(items[0]?.axisValue || "", platformGranularity), items),
      },
      legend: { type: "scroll", top: 6, left: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#555e6a", fontSize: 9 } },
      grid: { left: 42, right: 18, top: 48, bottom: 32 },
      xAxis: { type: "category", data: platformBuckets, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: "#9b9b96" } }, axisLabel: { color: "#5d6570", hideOverlap: true, interval: "auto", formatter: (value: string) => formatBucket(value, platformGranularity) } },
      yAxis: {
        type: "value", axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: "#68707b", formatter: (value: number) => formatNumber(value) },
        splitLine: { lineStyle: { color: "#dedbd1" } },
      },
      dataZoom: showNavigator ? [{ type: "inside" }] : [],
      series: activeGroups.map((group) => ({
        name: group.label, type: "line", showSymbol: false, symbol: "circle", symbolSize: 6, lineStyle: { width: 2.4 }, itemStyle: { color: group.color }, emphasis: { focus: "series", lineStyle: { width: 3.2 } },
        data: platformBuckets.map((bucket) => counts.get(`${bucket}:${group.key}`) || 0),
      })),
    };
  }, [corpus, filters.endDate, filters.startDate, platformGranularity]);
  const conceptTrendOption = useMemo(() => {
    const conceptBuckets = buildTimeBuckets(filters.startDate, filters.endDate, conceptGranularity);
    const conceptCounts = new Map<string, number>();
    corpus.forEach((row) => {
      const bucket = bucketFor(row.published_at, conceptGranularity);
      OVERVIEW_CONCEPT_INDICATORS.forEach(([field]) => {
        if (row[field]) {
          const key = `${bucket}:${field}`;
          conceptCounts.set(key, (conceptCounts.get(key) || 0) + 1);
        }
      });
    });
    const showNavigator = conceptGranularity === "day" && conceptBuckets.length > 120;
    const colors = ["#c34e3f", "#a5668b", "#675f87", "#2f7e78", "#a16c31", "#3f5f8a"];
    return {
      animation: true, animationDuration: 360, animationDurationUpdate: 260, animationEasing: "quadraticOut", animationEasingUpdate: "quadraticOut",
      aria: { enabled: true, description: `Jumlah dokumen dengan indikator tekstual untuk enam konsep per ${conceptGranularity}.` },
      tooltip: {
        trigger: "axis", axisPointer: { type: "line" },
        formatter: (items: Array<SeriesTooltipItem & { axisValue: string }>) => seriesTooltip(formatBucket(items[0]?.axisValue || "", conceptGranularity), items),
      },
      legend: { type: "scroll", top: 6, left: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#555e6a", fontSize: 9 } },
      grid: { left: 42, right: 18, top: 48, bottom: 32 },
      xAxis: { type: "category", data: conceptBuckets, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: "#9b9b96" } }, axisLabel: { color: "#5d6570", hideOverlap: true, interval: "auto", formatter: (value: string) => formatBucket(value, conceptGranularity) } },
      yAxis: { type: "value", axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#68707b", formatter: (value: number) => formatNumber(value) }, splitLine: { lineStyle: { color: "#dedbd1" } } },
      dataZoom: showNavigator ? [{ type: "inside" }] : [],
      series: OVERVIEW_CONCEPT_INDICATORS.map(([field, label], index) => ({ name: label, type: "line", showSymbol: false, symbol: "circle", symbolSize: 6, lineStyle: { width: 2.4 }, itemStyle: { color: colors[index] }, emphasis: { focus: "series", lineStyle: { width: 3.2 } }, data: conceptBuckets.map((bucket) => conceptCounts.get(`${bucket}:${field}`) || 0) })),
    };
  }, [conceptGranularity, corpus, filters.endDate, filters.startDate]);

  return <>
    <PageLead tab="corpus" title="Korpus dan waktu">
      Cakupan dokumen dan perubahan volume percakapan pada 2021–2024.
    </PageLead>
    <OverviewFiltersBar filters={filters} setFilters={setFilters} />
    <StatLedger items={[
      { label: "Dokumen unik", value: corpus.length, note: "dokumen sesuai filter" },
      { label: "Media sosial", value: corpus.filter((row) => row.channel === "media_sosial").length, note: "unggahan unik", accent: "var(--vermilion)" },
      { label: "Media massa", value: corpus.filter((row) => row.channel === "media_massa").length, note: "dokumen berita", accent: "var(--cobalt)" },
      { label: "Masuk jaringan", value: networkDocuments.size, note: "memiliki relasi terkode", accent: "var(--cobalt)" },
    ]} />
    {corpus.length === 0 ? <EmptyState>Ubah periode atau kanal pada filter korpus.</EmptyState> : <section className="corpus-spread">
      <article className="figure figure-wide" ref={trendRef}>
        <div className="figure-caption">
          <div><h2>Jumlah artikel</h2><p>Dokumen unik per {unitLabel.toLowerCase()} menurut kanal.</p></div>
          <FigureActions targetRef={trendRef} name="Jumlah artikel" />
          <div className="figure-actions">
            <div className="chart-controls">
              <span>Tampilan</span>
              <div role="group" aria-label="Granularitas waktu">
                {(["year", "month", "day"] as const).map((granularity) => (
                  <button key={granularity} aria-pressed={filters.granularity === granularity} onClick={() => setFilters({ ...filters, granularity })}>
                    {{ year: "Tahun", month: "Bulan", day: "Hari" }[granularity]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {peak && <aside><small>Volume tertinggi</small><strong>{formatBucket(peak.bucket, filters.granularity)}</strong><span>{formatNumber(peak.count)} dokumen</span></aside>}
        </div>
        <ReactECharts key={`trend-${filters.granularity}-${showDailyNavigator ? "zoom" : "full"}`} option={trendOption} replaceMerge={["series", "legend", "xAxis", "yAxis", "dataZoom"]} style={{ height: 350 }} />
        <section className="event-strip" aria-label="Periode penting">
          <header><strong>Periode penting</strong><span>Klik untuk melihat volume harian; klik kembali periode aktif untuk mengatur ulang.</span></header>
          <div className="event-list">
            {visibleEvents.map((event) => {
              const isActive = filters.startDate === event.start_date && filters.endDate === event.end_date;
              const nextFilters = isActive
                ? { ...filters, startDate: INITIAL_OVERVIEW_FILTERS.startDate, endDate: INITIAL_OVERVIEW_FILTERS.endDate, granularity: "month" as const }
                : { ...filters, startDate: event.start_date, endDate: event.end_date, granularity: "day" as const };
              return <button key={event.event_id} className={isActive ? "active" : ""} aria-pressed={isActive} onClick={() => setFilters(nextFilters)}>
                <span className="event-copy"><strong>{event.event_name}</strong><time dateTime={event.start_date}>{formatDateRange(event.start_date, event.end_date)}</time></span>
              </button>;
            })}
          </div>
        </section>
      </article>
      <article className="figure figure-narrow" ref={termRef}><div className="figure-caption"><div><h2>Indikator konsep</h2><p>Dokumen dengan pemicu tekstual tiap konsep.</p></div><FigureActions targetRef={termRef} name="Indikator konsep" /></div><ReactECharts className="term-chart" option={termOption} replaceMerge={["series", "xAxis", "yAxis"]} style={{ height: 442 }} /></article>
    </section>}
    {corpus.length > 0 && <section className="overview-extensions">
      <article className="figure figure-full" ref={platformRef}>
        <div className="figure-caption">
          <div><h2>Tren per platform</h2><p>Dokumen per platform.</p></div>
          <FigureActions targetRef={platformRef} name="Tren per platform" />
          <div className="figure-actions">
            <div className="chart-controls">
              <span>Tampilan</span>
              <div role="group" aria-label="Granularitas waktu platform">
                {(["year", "month", "day"] as const).map((granularity) => <button key={granularity} aria-pressed={platformGranularity === granularity} onClick={() => setPlatformGranularity(granularity)}>{{ year: "Tahun", month: "Bulan", day: "Hari" }[granularity]}</button>)}
              </div>
            </div>
          </div>
        </div>
        <ReactECharts key={`platform-${platformGranularity}`} option={platformOption} replaceMerge={["series", "legend", "xAxis", "yAxis", "dataZoom"]} style={{ height: 310 }} />
      </article>
      <article className="figure figure-full" ref={conceptRef}>
        <div className="figure-caption">
          <div><h2>Tren konsep</h2><p>Dokumen dengan pemicu tekstual.</p></div>
          <FigureActions targetRef={conceptRef} name="Tren konsep" />
          <div className="figure-actions">
            <div className="chart-controls">
              <span>Tampilan</span>
              <div role="group" aria-label="Granularitas waktu konsep">
                {(["year", "month", "day"] as const).map((granularity) => <button key={granularity} aria-pressed={conceptGranularity === granularity} onClick={() => setConceptGranularity(granularity)}>{{ year: "Tahun", month: "Bulan", day: "Hari" }[granularity]}</button>)}
              </div>
            </div>
          </div>
        </div>
        <ReactECharts key={`concept-${conceptGranularity}`} option={conceptTrendOption} replaceMerge={["series", "legend", "xAxis", "yAxis", "dataZoom"]} style={{ height: 310 }} />
      </article>
    </section>}
  </>;
}

type NetworkNodeSelection = {
  id: string;
  type: "actor" | "concept" | "subconcept" | "supporting";
  value: string;
  concept?: string;
  subconcept?: string;
} | null;
type ForceGraphComponent = typeof import("react-force-graph-2d").default;
type GraphLayoutStyle = "organic" | "columns";

function NetworkGraph({ statements, actorUniverseStatements, documents, codebook, statementFacets, documentFacets, periodLabel, selected, onSelect }: { statements: Edge[]; actorUniverseStatements: Edge[]; documents: DocumentConcept[]; codebook: SubconceptDefinition[]; statementFacets: StatementSubconcept[]; documentFacets: DocumentSubconcept[]; periodLabel: string; selected: NetworkNodeSelection; onSelect: (node: NetworkNodeSelection) => void }) {
  type GraphNode = { id: string; type: "actor" | "concept" | "subconcept" | "supporting"; label: string; documents: number; active?: boolean; concept?: string; subconcept?: string; documentId?: string; stance?: string; anchorX?: number; anchorY?: number; vx?: number; vy?: number; x?: number; y?: number; fx?: number; fy?: number };
  type GraphLink = { id: string; source: string | GraphNode; target: string | GraphNode; stance: string; documents: number; arena: "main" | "context" | "hierarchy" | "facet" | "supporting" };
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 640 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [ForceGraph, setForceGraph] = useState<ForceGraphComponent | null>(null);
  const positionCache = useRef(new Map<string, { x: number; y: number }>());
  const [layoutStyle, setLayoutStyle] = useState<GraphLayoutStyle>("organic");
  const pendingFit = useRef(true);
  const expandedConcept = selected?.type === "concept" ? selected.value : selected?.concept;
  const graphData = useMemo(() => {
    const mainTies = new Map<string, { actor: string; concept: string; stance: string; documents: Set<string> }>();
    const actorDocuments = new Map<string, Set<string>>();
    const actorUniverseDocuments = new Map<string, Set<string>>();
    actorUniverseStatements.forEach((edge) => {
      const actor = actorName(edge);
      if (!MAIN_NETWORK_ACTORS.has(actor)) return;
      if (!actorDocuments.has(actor)) actorDocuments.set(actor, new Set<string>());
      const universeDocuments = actorUniverseDocuments.get(actor) || new Set<string>();
      universeDocuments.add(edge.document_id);
      actorUniverseDocuments.set(actor, universeDocuments);
    });
    const conceptDocuments = new Map<string, Set<string>>();
    statements.forEach((edge) => {
      const actor = actorName(edge);
      if (!MAIN_NETWORK_ACTORS.has(actor)) return;
      const tieKey = `${actor}|${edge.concept}|${edge.stance}`;
      const tie = mainTies.get(tieKey) || { actor, concept: edge.concept, stance: edge.stance, documents: new Set<string>() };
      tie.documents.add(edge.document_id);
      mainTies.set(tieKey, tie);
      const actorSet = actorDocuments.get(actor) || new Set<string>(); actorSet.add(edge.document_id); actorDocuments.set(actor, actorSet);
      const conceptSet = conceptDocuments.get(edge.concept) || new Set<string>(); conceptSet.add(edge.document_id); conceptDocuments.set(edge.concept, conceptSet);
    });
    const conceptsByDocument = new Map<string, Set<string>>();
    documents.forEach((row) => {
      const values = conceptsByDocument.get(row.document_id) || new Set<string>();
      values.add(row.concept);
      conceptsByDocument.set(row.document_id, values);
    });
    const signedPairs = new Set(Array.from(mainTies.values()).map((tie) => `${tie.actor}|${tie.concept}`));
    const contextTies = new Map<string, { actor: string; concept: string; documents: Set<string> }>();
    statements.forEach((edge) => {
      const actor = actorName(edge);
      if (!MAIN_NETWORK_ACTORS.has(actor)) return;
      conceptsByDocument.get(edge.document_id)?.forEach((concept) => {
        const pair = `${actor}|${concept}`;
        if (signedPairs.has(pair)) return;
        const tie = contextTies.get(pair) || { actor, concept, documents: new Set<string>() };
        tie.documents.add(edge.document_id);
        contextTies.set(pair, tie);
      });
    });
    // The overview stays limited to the core actor set. Inside a concept, add every
    // actor with a verified actor-subconcept statement so smaller media actors do
    // not disappear from the detailed network and its centrality table.
    if (expandedConcept) statementFacets
      .filter((row) => row.concept === expandedConcept && ["support", "oppose"].includes(row.stance))
      .forEach((row) => {
        const actorSet = actorDocuments.get(row.actor) || new Set<string>();
        actorSet.add(row.document_id);
        actorDocuments.set(row.actor, actorSet);
        const universeSet = actorUniverseDocuments.get(row.actor) || new Set<string>();
        universeSet.add(row.document_id);
        actorUniverseDocuments.set(row.actor, universeSet);
      });
    const actors = Array.from(actorDocuments).sort((left, right) =>
      (actorUniverseDocuments.get(right[0])?.size || 0) - (actorUniverseDocuments.get(left[0])?.size || 0) || left[0].localeCompare(right[0]));
    const concepts = Object.keys(CONCEPT_LABELS).map((concept) => [concept, new Set(documents.filter((row) => row.concept === concept).map((row) => row.document_id))] as const);
    // A DNA affiliation graph reads as two modes facing each other, so the overview puts
    // actors in a left column and concepts in a right one. Order comes from the whole
    // period, not the filtered slice, so filtering changes the edges and never the rows.
    const conceptOrder = concepts.map(([concept]) => concept);
    const universeConceptCounts = new Map<string, Map<string, number>>();
    actorUniverseStatements.forEach((edge) => {
      const actor = actorName(edge);
      if (!MAIN_NETWORK_ACTORS.has(actor)) return;
      const byConcept = universeConceptCounts.get(actor) || new Map<string, number>();
      byConcept.set(edge.concept, (byConcept.get(edge.concept) || 0) + 1);
      universeConceptCounts.set(actor, byConcept);
    });
    const dominantRank = (actor: string) => {
      const byConcept = universeConceptCounts.get(actor);
      if (!byConcept?.size) return conceptOrder.length;
      const best = Array.from(byConcept).sort((left, right) =>
        right[1] - left[1] || conceptOrder.indexOf(left[0]) - conceptOrder.indexOf(right[0]))[0][0];
      const rank = conceptOrder.indexOf(best);
      return rank < 0 ? conceptOrder.length : rank;
    };
    const ACTOR_COLUMN_X = -250;
    const CONCEPT_COLUMN_X = 290;
    // Grouping actors by the concept they speak to most puts each one across from its own
    // landmark, which is what removes most of the edge crossings.
    const columnActors = actors.map(([actor]) => actor).sort((left, right) =>
      dominantRank(left) - dominantRank(right)
      || (actorUniverseDocuments.get(right)?.size || 0) - (actorUniverseDocuments.get(left)?.size || 0)
      || left.localeCompare(right));
    const actorSpan = Math.max(columnActors.length - 1, 1);
    const actorGap = Math.min(38, 500 / actorSpan);
    const columnActorPoints = new Map(columnActors.map((actor, index) => [actor, {
      x: ACTOR_COLUMN_X, y: (index - actorSpan / 2) * actorGap,
    }]));
    // Gaya organik: konsep jadi landmark di sebuah cincin, aktor disemai di kelopak
    // konsep dominannya lalu dibiarkan ditata simulasi gaya, seperti spring embedder visone.
    const ringConceptPoints = new Map(concepts.map(([concept], index) => {
      const angle = -Math.PI / 2 + index * (2 * Math.PI / concepts.length);
      return [concept, { x: Math.cos(angle) * 290, y: Math.sin(angle) * 190 }];
    }));
    const petalSizes = new Map<number, number>();
    columnActors.forEach((actor) => {
      const rank = dominantRank(actor);
      petalSizes.set(rank, (petalSizes.get(rank) || 0) + 1);
    });
    const petalSeats = new Map<number, number>();
    const organicActorPoints = new Map(columnActors.map((actor) => {
      const rank = dominantRank(actor);
      const seat = petalSeats.get(rank) || 0;
      petalSeats.set(rank, seat + 1);
      if (rank >= conceptOrder.length) {
        const angle = seat * 2.39996323;
        return [actor, { x: Math.cos(angle) * 70, y: Math.sin(angle) * 70 }];
      }
      const base = ringConceptPoints.get(conceptOrder[rank]) || { x: 0, y: 0 };
      const outward = Math.atan2(base.y, base.x);
      // Each seat gets its own angle across the petal. A repeating pattern would let two
      // actors seed on the same point, where the repulsion vector is zero and they stay stuck.
      const size = petalSizes.get(rank) || 1;
      const fan = size > 1 ? (seat / (size - 1) - .5) * Math.min(1.5, .34 * size) : 0;
      const reach = 150 + (seat % 2) * 62;
      return [actor, { x: base.x + Math.cos(outward + fan) * reach, y: base.y + Math.sin(outward + fan) * reach }];
    }));
    const conceptGap = Math.min(96, 460 / Math.max(concepts.length - 1, 1));
    const columnConceptPoints = new Map(concepts.map(([concept], index) => [concept, {
      x: CONCEPT_COLUMN_X, y: (index - (concepts.length - 1) / 2) * conceptGap,
    }]));
    // Fixed landmarks let readers compare years without mistaking rotation for change.
    const conceptPoints = expandedConcept
      ? new Map(concepts.map(([concept], index) => [concept, {
          x: (index % 3 - 1) * 290, y: index < 3 ? -145 : 145,
        }]))
      : layoutStyle === "columns" ? columnConceptPoints : ringConceptPoints;
    // Subkonsep digambar hanya bila memikul bukti yang cukup untuk dibaca sebagai
    // garis argumen: minimal satu posisi aktor terkode, atau cukup banyak dokumen.
    // Node dengan satu dokumen dan tanpa pernyataan hanya menambah titik kosong.
    const facetSupport = new Map<string, { statements: number; documents: number }>();
    const countFacet = (subconcept: string, field: "statements" | "documents") => {
      const entry = facetSupport.get(subconcept) || { statements: 0, documents: 0 };
      entry[field] += 1;
      facetSupport.set(subconcept, entry);
    };
    statementFacets.filter((row) => row.concept === expandedConcept).forEach((row) => countFacet(row.subconcept, "statements"));
    documentFacets.filter((row) => row.concept === expandedConcept).forEach((row) => countFacet(row.subconcept, "documents"));
    const conceptFacets = expandedConcept ? codebook.filter((row) => row.concept === expandedConcept) : [];
    const activeFacets = conceptFacets.filter((row) => {
      const support = facetSupport.get(row.subconcept);
      return !!support && (support.statements > 0 || support.documents >= MIN_FACET_DOCUMENTS);
    });
    const drawnFacets = new Set(activeFacets.map((row) => row.subconcept));
    const activeCenter = expandedConcept ? conceptPoints.get(expandedConcept)! : { x: 0, y: 0 };
    const facetAngles = new Map(activeFacets.map((facet, index) =>
      [facet.subconcept, -Math.PI / 2 + index * (2 * Math.PI / activeFacets.length)]));
    const FACET_RING = 205;
    const facetPoints = new Map(activeFacets.map((facet) => {
      const angle = facetAngles.get(facet.subconcept) || 0;
      return [facet.subconcept, { x: activeCenter.x + Math.cos(angle) * FACET_RING, y: activeCenter.y + Math.sin(angle) * FACET_RING }];
    }));
    const facetTies = new Map<string, { actor: string; subconcept: string; stance: string; documents: Set<string> }>();
    if (expandedConcept) statementFacets.filter((row) => row.concept === expandedConcept).forEach((row) => {
      const actor = row.actor;
      if (!["support", "oppose"].includes(row.stance) || !drawnFacets.has(row.subconcept)) return;
      const key = `${actor}|${row.subconcept}|${row.stance}`;
      const tie = facetTies.get(key) || { actor, subconcept: row.subconcept, stance: row.stance, documents: new Set<string>() };
      tie.documents.add(row.document_id);
      facetTies.set(key, tie);
    });
    const actorSeats = new Map<string, number>();
    const actorPoint = (actor: string, index: number) => {
      const detail = Array.from(facetTies.values()).filter((tie) => tie.actor === actor);
      if (expandedConcept && detail.length) {
        const strongest = [...detail].sort((a, b) => b.documents.size - a.documents.size)[0];
        const base = facetAngles.get(strongest.subconcept) ?? 0;
        const seat = actorSeats.get(strongest.subconcept) || 0;
        actorSeats.set(strongest.subconcept, seat + 1);
        const spread = Math.min(.46, 1.5 / Math.max(activeFacets.length, 1));
        const angle = base + ((seat % 3) - 1) * spread;
        const reach = 104 + Math.floor(seat / 3) * 32;
        return { x: activeCenter.x + Math.cos(angle) * reach, y: activeCenter.y + Math.sin(angle) * reach };
      }
      if (!expandedConcept) return (layoutStyle === "columns" ? columnActorPoints.get(actor) : organicActorPoints.get(actor))
        || { x: ACTOR_COLUMN_X, y: 0 };
      const ties = [
        ...Array.from(mainTies.values()).filter((tie) => tie.actor === actor).map((tie) => ({ ...tie, weight: Math.sqrt(tie.documents.size) })),
        ...Array.from(contextTies.values()).filter((tie) => tie.actor === actor).map((tie) => ({ ...tie, stance: "context", weight: Math.sqrt(tie.documents.size) * .45 })),
      ];
      const total = ties.reduce((sum, tie) => sum + tie.weight, 0);
      if (!total) {
        const angle = index * 2.39996323;
        return { x: Math.cos(angle) * 420, y: Math.sin(angle) * 260 };
      }
      const center = ties.reduce((point, tie) => {
        const landmark = conceptPoints.get(tie.concept)!;
        const weight = tie.weight / total;
        return { x: point.x + landmark.x * weight, y: point.y + landmark.y * weight };
      }, { x: 0, y: 0 });
      const strongest = [...ties].sort((a, b) => b.weight - a.weight)[0];
      // Opposite half-orbits encode stance toward the strongest linked proposition.
      const angle = (strongest.stance === "oppose" ? Math.PI : 0) + .25 + (index * 2.39996 % 2.55);
      return { x: center.x + Math.cos(angle) * 85, y: center.y + Math.sin(angle) * 85 };
    };
    const nodes: GraphNode[] = [
      ...actors.map(([actor, documents], index) => {
        const point = actorPoint(actor, index);
        return { id: `actor:${actor}`, type: "actor" as const, label: displayActorName(actor), documents: documents.size, active: documents.size > 0, concept: expandedConcept,
          anchorX: point.x, anchorY: point.y, ...point,
          ...(expandedConcept || layoutStyle === "organic" ? {} : { fx: point.x, fy: point.y }),
        };
      }),
      ...concepts.map(([concept, documents]) => {
        const point = conceptPoints.get(concept) || { x: 0, y: 0 };
        return { id: `concept:${concept}`, type: "concept" as const, label: CONCEPT_LABELS[concept] || concept, documents: documents.size, ...point, fx: point.x, fy: point.y };
      }),
      ...activeFacets.map((facet) => {
        const point = facetPoints.get(facet.subconcept) || activeCenter;
        const count = documentFacets.filter((row) => row.concept === expandedConcept && row.subconcept === facet.subconcept).length;
        return { id: `subconcept:${expandedConcept}:${facet.subconcept}`, type: "subconcept" as const, label: facet.label, documents: count, concept: expandedConcept, subconcept: facet.subconcept, ...point, fx: point.x, fy: point.y };
      }),
    ];
    const links: GraphLink[] = Array.from(mainTies.values()).map((tie) => ({
      id: `edge:${tie.actor}:${tie.concept}:${tie.stance}`,
      source: `actor:${tie.actor}`,
      target: `concept:${tie.concept}`,
      stance: tie.stance,
      documents: tie.documents.size,
      arena: "main" as const,
    }));
    contextTies.forEach((tie) => links.push({
      id: `context:${tie.actor}:${tie.concept}`,
      source: `actor:${tie.actor}`,
      target: `concept:${tie.concept}`,
      stance: "context",
      documents: tie.documents.size,
      arena: "context",
    }));
    if (expandedConcept) {
      activeFacets.forEach((facet) => links.push({
        id: `hierarchy:${expandedConcept}:${facet.subconcept}`,
        source: `concept:${expandedConcept}`,
        target: `subconcept:${expandedConcept}:${facet.subconcept}`,
        stance: "context",
        documents: documentFacets.filter((row) => row.concept === expandedConcept && row.subconcept === facet.subconcept).length,
        arena: "hierarchy",
      }));
      facetTies.forEach((tie) => links.push({
        id: `facet:${tie.actor}:${tie.subconcept}:${tie.stance}`,
        source: `actor:${tie.actor}`,
        target: `subconcept:${expandedConcept}:${tie.subconcept}`,
        stance: tie.stance,
        documents: tie.documents.size,
        arena: "facet",
      }));
    }
    if (expandedConcept) {
      const center = conceptPoints.get(expandedConcept)!;
      const byDocument = new Map(documents.filter((row) => row.concept === expandedConcept).map((row) => [row.document_id, row]));
      // v2 lets one document articulate several subconcepts, and the scores are all 1.0,
      // so there is no winner to pick. One node per document-subconcept articulation keeps
      // every subconcept's evidence on screen instead of letting the first row take all.
      const articulations = documentFacets.filter((row) => row.concept === expandedConcept
        && byDocument.has(row.document_id) && drawnFacets.has(row.subconcept));
      const wedge = Math.min(.34, 1.1 / Math.max(activeFacets.length, 1));
      const facetSeats = new Map<string, number>();
      const placed = new Set<string>();
      const matched = new Set<string>();
      articulations.forEach((item) => {
        const key = `${item.subconcept}:${item.document_id}`;
        if (placed.has(key)) return;
        placed.add(key);
        matched.add(item.document_id);
        const row = byDocument.get(item.document_id)!;
        const facetCenter = facetPoints.get(item.subconcept) || center;
        const outward = facetAngles.get(item.subconcept) ?? 0;
        const seat = facetSeats.get(item.subconcept) || 0;
        facetSeats.set(item.subconcept, seat + 1);
        // Documents fan outward from their own subconcept, so the evidence layer never
        // crosses the middle where the concept and its actors sit.
        const angle = outward + (((seat * 2.39996323) % (2 * Math.PI)) - Math.PI) * wedge;
        const reach = 44 + Math.sqrt(seat + 1) * 5.6;
        const x = facetCenter.x + Math.cos(angle) * reach;
        const y = facetCenter.y + Math.sin(angle) * reach;
        nodes.push({ id: `supporting:${item.subconcept}:${item.document_id}`, type: "supporting",
          label: row.author ? displayActorName(row.author) : row.title || "Dokumen tanpa nama akun",
          documents: 1, concept: expandedConcept, subconcept: item.subconcept, documentId: item.document_id,
          stance: row.stance, x, y, anchorX: x, anchorY: y });
        links.push({ id: `document:${item.subconcept}:${item.document_id}`,
          source: `supporting:${item.subconcept}:${item.document_id}`,
          target: `subconcept:${expandedConcept}:${item.subconcept}`,
          stance: row.stance, documents: 1, arena: "supporting" });
      });
      // Documents that match no retained subconcept still belong to the concept itself.
      Array.from(byDocument.values()).filter((row) => !matched.has(row.document_id)).forEach((row, index) => {
        const angle = index * 2.39996323;
        const reach = 58 + Math.sqrt(index + 1) * 5.2;
        const x = center.x + Math.cos(angle) * reach;
        const y = center.y + Math.sin(angle) * reach;
        nodes.push({ id: `supporting:${expandedConcept}:${row.document_id}`, type: "supporting",
          label: row.author ? displayActorName(row.author) : row.title || "Dokumen tanpa nama akun",
          documents: 1, concept: expandedConcept, documentId: row.document_id, stance: row.stance, x, y, anchorX: x, anchorY: y });
        links.push({ id: `document:${expandedConcept}:${row.document_id}`,
          source: `supporting:${expandedConcept}:${row.document_id}`, target: `concept:${expandedConcept}`,
          stance: row.stance, documents: 1, arena: "supporting" });
      });
      // Evidence first, actors last: the canvas paints in array order, so this stops
      // hundreds of document dots from covering the actors and their labels.
      const depth = { supporting: 0, concept: 1, subconcept: 2, actor: 3 };
      nodes.sort((left, right) => depth[left.type] - depth[right.type]);
    }
    return { nodes, links };
  }, [expandedConcept, layoutStyle, statements, actorUniverseStatements, documents, codebook, statementFacets, documentFacets]);
  useEffect(() => {
    let mounted = true;
    import("react-force-graph-2d").then(({ default: component }) => {
      if (mounted) setForceGraph(() => component);
    });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setDimensions({ width: Math.floor(entry.contentRect.width), height: 640 }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !dimensions.width) return;
    graphData.nodes.filter((node) => node.type === "actor").forEach((node) => {
      if (!expandedConcept && node.anchorX !== undefined) {
        node.x = node.anchorX; node.y = node.anchorY;
        // Kolom dipaku agar deterministik; organik hanya disemai lalu diserahkan ke simulasi.
        const pinned = layoutStyle === "columns";
        node.fx = pinned ? node.anchorX : undefined;
        node.fy = pinned ? node.anchorY : undefined;
        return;
      }
      if (expandedConcept && node.anchorX !== undefined) {
        node.x = node.anchorX; node.y = node.anchorY;
        node.fx = undefined; node.fy = undefined;
        return;
      }
      const cached = positionCache.current.get(node.id);
      if (!cached) return;
      node.x = cached.x; node.y = cached.y;
      node.fx = undefined;
      node.fy = undefined;
    });
    const charge = graph.d3Force("charge") as { strength?: (value: number | ((node: GraphNode) => number)) => unknown } | undefined;
    const link = graph.d3Force("link") as { distance?: (value: number | ((edge: GraphLink) => number)) => unknown; strength?: (value: number | ((edge: GraphLink) => number)) => unknown } | undefined;
    const organic = !expandedConcept && layoutStyle === "organic";
    charge?.strength?.((node) => node.type === "supporting" ? -12 : node.type === "subconcept" ? -65
      : organic ? (node.type === "concept" ? -430 : -250) : -45);
    graph.d3Force("center", null);
    graph.d3Force("cluster", (alpha: number) => {
      graphData.nodes.forEach((node) => {
        if (node.fx !== undefined || node.anchorX === undefined) return;
        const pull = organic ? .05 : .22;
        node.vx = (node.vx || 0) + (node.anchorX - (node.x || 0)) * alpha * pull;
        node.vy = (node.vy || 0) + ((node.anchorY || 0) - (node.y || 0)) * alpha * pull;
      });
      for (let i = 0; i < graphData.nodes.length && graphData.nodes.length < 150; i++) {
        for (let j = i + 1; j < graphData.nodes.length; j++) {
          const a = graphData.nodes[i], b = graphData.nodes[j];
          const dx = (b.x || 0) - (a.x || 0), dy = (b.y || 0) - (a.y || 0);
          const distance = Math.hypot(dx, dy) || 1;
          const gap = a.type === "supporting" && b.type === "supporting" ? 15
            : organic ? (a.type === "concept" || b.type === "concept" ? 78 : 60) : 46;
          if (distance >= gap) continue;
          const push = (gap - distance) / distance * .15;
          if (a.fx === undefined) { a.vx = (a.vx || 0) - dx * push; a.vy = (a.vy || 0) - dy * push; }
          if (b.fx === undefined) { b.vx = (b.vx || 0) + dx * push; b.vy = (b.vy || 0) + dy * push; }
        }
      }
    });
    link?.distance?.((edge) => edge.arena === "supporting" ? 55 : edge.arena === "hierarchy" ? 145
      : organic ? (edge.arena === "context" ? 215 : 125) : edge.arena === "context" ? 105 : 90);
    link?.strength?.((edge) => edge.arena === "supporting" ? 0.025
      : organic ? (edge.arena === "context" ? 0.012 : 0.5) : edge.arena === "context" ? 0.035 : 0.06);
    graph.d3ReheatSimulation();
  }, [graphData, dimensions.width, ForceGraph, expandedConcept, layoutStyle]);
  useEffect(() => {
    const concept = graphData.nodes.find((node) => node.id === `concept:${expandedConcept}`);
    graphRef.current?.centerAt(concept?.x || 0, concept?.y || 0, 600);
    const count = graphData.nodes.filter((node) => node.type === "supporting").length;
    const radius = 230 + Math.sqrt(count) * 6;
    const zoom = expandedConcept ? Math.min(dimensions.width / (radius * 2 + 100), 550 / (radius * 2), 1.8)
      : layoutStyle === "columns" ? Math.min(dimensions.width / 880, 1.05) : Math.min(dimensions.width / 1120, .9);
    pendingFit.current = expandedConcept ? true : layoutStyle === "organic";
    graphRef.current?.zoom(zoom, 600);
  }, [dimensions.width, ForceGraph, expandedConcept, graphData, layoutStyle]);
  const relatedNodeIds = useMemo(() => {
    if (!selected) return null;
    const ids = new Set<string>([selected.id]);
    graphData.links.forEach((link) => {
      const source = typeof link.source === "string" ? link.source : link.source.id;
      const target = typeof link.target === "string" ? link.target : link.target.id;
      if (source === selected.id) ids.add(target);
      if (target === selected.id) ids.add(source);
    });
    return ids;
  }, [graphData.links, selected]);
  const nodeRadius = (node: GraphNode) => {
    if (node.type === "supporting") return Math.max(2.5, Math.min(5, 2.2 + Math.sqrt(node.documents) * .45));
    if (node.type === "subconcept") return Math.max(7, Math.min(13, 6 + Math.sqrt(node.documents) * .38));
    if (node.type === "concept") return Math.max(9, Math.min(17, 8 + Math.sqrt(node.documents) * 1.15));
    return Math.max(5, Math.min(13, 4.5 + Math.sqrt(node.documents) * 1.05));
  };
  const isRelated = (id: string) => !relatedNodeIds || relatedNodeIds.has(id);
  const nodeCanvasObject = (node: GraphNode, context: CanvasRenderingContext2D, scale: number) => {
    const radius = nodeRadius(node);
    const active = selected?.id === node.id;
    const labelled = active || hoveredId === node.id || node.type === "concept" || node.type === "subconcept" || node.type === "actor";
    context.globalAlpha = (node.type === "actor" && node.active === false && !active ? .24 : 1)
      * (node.type === "supporting" && !active ? .74 : 1) * (isRelated(node.id) ? 1 : 0.3);
    context.beginPath();
    if (node.type === "concept") {
      const reach = radius * 1.3;
      const x = node.x || 0; const y = node.y || 0;
      context.moveTo(x, y - reach); context.lineTo(x + reach, y);
      context.lineTo(x, y + reach); context.lineTo(x - reach, y);
      context.closePath();
    } else {
      context.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI);
    }
    context.fillStyle = node.type === "actor" ? (node.active === false ? "#87909b" : "#315f9a") : node.type === "concept" ? "#d99b2b" : node.type === "subconcept" ? "#efd08a" : node.stance === "oppose" ? "#c94a39" : node.stance === "unclear" ? "#a4a6aa" : node.stance === "mixed" ? "#756779" : "#17845f";
    context.fill();
    context.lineWidth = active ? 3 / scale : node.type === "concept" ? 1.5 / scale : 1 / scale;
    context.strokeStyle = active ? "#17212e" : node.type === "concept" ? "#fff2d0" : node.type === "subconcept" ? "#9a6b14" : node.type === "supporting" ? "#fffdf7" : "#b5c8e4";
    context.stroke();
    if (labelled) {
      context.globalAlpha = (node.type === "actor" && node.active === false ? .42 : 1) * (isRelated(node.id) ? 1 : .4);
      context.font = `${node.type === "concept" || node.type === "subconcept" ? 600 : 500} ${Math.max(11 / scale, 3.8)}px Inter, sans-serif`;
      const text = node.label.length > 32 ? `${node.label.slice(0, 30)}…` : node.label;
      const width = context.measureText(text).width;
      // In the two-column overview each label sits outside its own column. That is what
      // keeps fifteen actor names from piling up in the middle of the canvas.
      const outside = !expandedConcept && layoutStyle === "columns" && (node.type === "actor" || node.type === "concept");
      if (outside) {
        const toLeft = node.type === "actor";
        context.textAlign = toLeft ? "right" : "left";
        context.textBaseline = "middle";
        const x = (node.x || 0) + (toLeft ? -(radius + 7 / scale) : radius + 7 / scale);
        const y = node.y || 0;
        context.fillStyle = "rgba(255,253,247,.94)";
        context.fillRect((toLeft ? x - width : x) - 4 / scale, y - 7.5 / scale, width + 8 / scale, 15 / scale);
        context.fillStyle = "#1e2631";
        context.fillText(text, x, y);
      } else {
        context.textAlign = "center";
        context.textBaseline = "top";
        const x = node.x || 0; const y = (node.y || 0) + radius + 5 / scale;
        context.fillStyle = "rgba(255,253,247,.94)";
        context.fillRect(x - width / 2 - 4 / scale, y - 2 / scale, width + 8 / scale, 15 / scale);
        context.fillStyle = "#1e2631";
        context.fillText(text, x, y);
      }
    }
    context.globalAlpha = 1;
  };
  const linkId = (value: string | GraphNode) => typeof value === "string" ? value : value.id;
  const linkIsRelated = (link: GraphLink) => !selected || linkId(link.source) === selected.id || linkId(link.target) === selected.id;
  const resetView = () => {
    onSelect(null);
    graphRef.current?.centerAt(0, 0, 350);
    graphRef.current?.zoom(layoutStyle === "columns" ? Math.min(dimensions.width / 880, 1.05) : Math.min(dimensions.width / 1120, .9), 350);
  };
  const nodeVisible = (node: GraphNode) => !expandedConcept
    || node.id === `concept:${expandedConcept}`
    || node.type === "supporting"
    || (node.type === "subconcept" && node.concept === expandedConcept)
    || (node.type === "actor" && graphData.links.some((link) => link.arena === "facet" && linkId(link.source) === node.id));
  const linkVisible = (link: GraphLink) => !expandedConcept || ["hierarchy", "facet", "supporting"].includes(link.arena);
  return <div ref={stageRef} className="graph-stage force-graph-stage" role="img" aria-label="Jaringan bertingkat aktor, konsep, subkonsep, dan dokumen."><div className="graph-period-marker"><span>Periode jaringan</span><strong>{periodLabel}</strong></div><div className="graph-legend" aria-label="Legenda jaringan">{expandedConcept ? <>
      <span><i className="concept-shape" /> Konsep</span>
      <span><i className="subconcept-shape" /> Subkonsep</span>
      <span><i className="actor-shape" /> Aktor utama</span>
      <span><i className="social-shape" /> Dokumen</span>
      <span><i className="support-rule" /> Support</span>
      <span><i className="oppose-rule" /> Oppose</span>
    </> : <>
      <span><i className="actor-shape" /> Aktor utama</span>
      <span><i className="inactive-shape" /> Tidak aktif</span>
      <span><i className="concept-shape" /> Konsep</span>
      <span><i className="support-rule" /> Support</span>
      <span><i className="oppose-rule" /> Oppose</span>
      <span><i className="context-rule" /> Ko-okurensi</span>
    </>}</div><div className="graph-navigation">{!expandedConcept && <div className="graph-style-switch" role="group" aria-label="Gaya jaringan"><button aria-pressed={layoutStyle === "organic"} onClick={() => setLayoutStyle("organic")}>Organik</button><button aria-pressed={layoutStyle === "columns"} onClick={() => setLayoutStyle("columns")}>Kolom</button></div>}<button onClick={resetView}>Semua jaringan</button><button aria-label="Perbesar jaringan" onClick={() => { const graph = graphRef.current; if (graph) graph.zoom(graph.zoom() * 1.3, 250); }}>+</button><button aria-label="Perkecil jaringan" onClick={() => { const graph = graphRef.current; if (graph) graph.zoom(graph.zoom() / 1.3, 250); }}>−</button><FigureActions targetRef={stageRef} name={expandedConcept ? `Jaringan ${CONCEPT_LABELS[expandedConcept] || expandedConcept}` : "Jaringan wacana"} /></div>{ForceGraph && dimensions.width > 0 && <ForceGraph ref={graphRef} width={dimensions.width} height={dimensions.height} graphData={graphData} nodeVisibility={nodeVisible} linkVisibility={linkVisible} nodeId="id" nodeCanvasObject={nodeCanvasObject} nodePointerAreaPaint={(node, color, context) => { context.fillStyle = color; context.beginPath(); context.arc(node.x || 0, node.y || 0, nodeRadius(node) + 5, 0, 2 * Math.PI); context.fill(); }} nodeLabel={(node) => `${node.type === "actor" ? "Aktor utama" : node.type === "concept" ? "Konsep" : node.type === "subconcept" ? "Subkonsep" : "Dokumen"}: ${node.label} (${node.documents} dokumen)${node.type === "actor" && node.active === false ? " · tidak aktif pada periode ini" : ""}${node.stance ? ` · ${node.stance}` : ""}`} linkLabel={(link) => link.arena === "hierarchy" ? `${link.documents} dokumen pada subkonsep` : link.arena === "context" ? `Muncul dalam ${link.documents} dokumen yang memuat konsep; bukan stance aktor` : `${link.stance} · ${link.documents} dokumen`} linkWidth={(link) => link.arena === "supporting" ? Math.min(1.1, .38 + Math.sqrt(link.documents) * .14) : ["context", "hierarchy"].includes(link.arena) ? Math.min(1.5, .45 + Math.sqrt(link.documents) * .16) : Math.min(3.2, .5 + Math.sqrt(link.documents) * .32)} linkColor={(link) => !linkIsRelated(link) ? "rgba(75,88,104,.06)" : link.arena === "hierarchy" ? "rgba(173,129,45,.38)" : link.arena === "context" ? (expandedConcept ? "rgba(75,88,104,.42)" : "rgba(75,88,104,.2)") : link.stance === "oppose" ? "rgba(190,74,55,.78)" : link.stance === "unclear" ? "rgba(125,130,137,.18)" : link.stance === "mixed" ? "rgba(117,103,121,.68)" : "rgba(32,116,83,.62)"} linkLineDash={(link) => ["context", "hierarchy"].includes(link.arena) ? [1, 4] : link.stance === "oppose" ? [4, 3] : link.stance === "mixed" ? [2, 3] : null} linkCurvature={(link) => expandedConcept ? (link.arena === "main" ? 0.09 : link.arena === "context" ? .04 : 0) : link.arena === "main" ? (link.stance === "oppose" ? -0.1 : 0.1) : link.arena === "context" ? 0.06 : 0} d3AlphaDecay={0.028} d3VelocityDecay={0.34} cooldownTime={4200} onEngineTick={() => { if (!expandedConcept) graphData.nodes.filter((node) => node.type === "actor").forEach((node) => positionCache.current.set(node.id, { x: node.x || 0, y: node.y || 0 })); }} onEngineStop={() => { if (pendingFit.current && (expandedConcept || layoutStyle === "organic")) { pendingFit.current = false; graphRef.current?.zoomToFit(420, 78); } }} onNodeHover={(node) => setHoveredId(node?.id || null)} onNodeClick={(node) => onSelect(selected?.id === node.id ? (node.type === "subconcept" ? { id: `concept:${node.concept}`, type: "concept", value: node.concept! } : null) : { id: node.id, type: node.type, value: node.type === "subconcept" ? node.subconcept! : node.type === "supporting" ? (node.documentId || "") : node.id.replace(/^(actor|concept):/, ""), concept: node.concept, subconcept: node.subconcept })} onNodeDragEnd={(node) => { if (node.type === "concept" || node.type === "subconcept") return; if (!expandedConcept && layoutStyle === "columns") { node.fx = node.x; node.fy = node.y; return; } node.fx = undefined; node.fy = undefined; graphRef.current?.d3ReheatSimulation(); }} onBackgroundClick={resetView} />}</div>;
}

function NetworkTab({ corpus, statements, documentConcepts, subconceptNetwork, events }: { documentConcepts: DocumentConcept[]; subconceptNetwork: SubconceptNetwork; corpus: CorpusDocument[]; statements: Edge[]; events: EventWindow[] }) {
  const [selected, setSelected] = useState<NetworkNodeSelection>(null);
  const [filters, setFilters] = useState({ year: "all", eventId: "all", query: "" });
  const [documentStance, setDocumentStance] = useState("all");
  const [dossierStance, setDossierStance] = useState("all");
  const [isPlaying, setIsPlaying] = useState(false);
  const years = useMemo(() => Array.from(new Set(corpus.map((row) => String(row.year)))).sort(), [corpus]);
  const query = filters.query.trim().toLowerCase();
  const contextualStatements = useMemo(() => statements.filter((edge) => {
    if (filters.eventId !== "all" && edge.event_id !== filters.eventId) return false;
    const actor = actorName(edge);
    return !query || actor.toLowerCase().includes(query) || displayActorName(actor).toLowerCase().includes(query) || (CONCEPT_LABELS[edge.concept] || edge.concept).toLowerCase().includes(query);
  }), [statements, filters.eventId, query]);
  const periodStatements = useMemo(() => contextualStatements.filter((edge) => filters.year === "all" || String(edge.year) === filters.year), [contextualStatements, filters.year]);
  const excludedAuditCount = periodStatements.filter((edge) => edge.network_included === false).length;
  const visibleStatements = useMemo(() => periodStatements.filter((edge) => edge.network_included !== false), [periodStatements]);
  const visibleDocuments = useMemo(() => documentConcepts.filter((row) =>
    (filters.year === "all" || String(row.year) === filters.year) &&
    (filters.eventId === "all" || row.event_id === filters.eventId)
  ), [documentConcepts, filters.year, filters.eventId]);
  const visibleStatementFacets = useMemo(() => subconceptNetwork.statementEdges.filter((row) =>
    row.network_included !== false &&
    (filters.year === "all" || String(row.year) === filters.year) &&
    (filters.eventId === "all" || row.event_id === filters.eventId)
  ), [subconceptNetwork.statementEdges, filters.year, filters.eventId]);
  const visibleDocumentFacets = useMemo(() => subconceptNetwork.documentEdges.filter((row) =>
    (filters.year === "all" || String(row.year) === filters.year) &&
    (filters.eventId === "all" || row.event_id === filters.eventId) &&
    (documentStance === "all" || row.stance === documentStance)
  ), [subconceptNetwork.documentEdges, filters.year, filters.eventId, documentStance]);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setFilters((current) => {
        const index = years.indexOf(current.year);
        if (index >= years.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return { ...current, year: years[Math.max(index + 1, 0)], eventId: "all" };
      });
    }, 1700);
    return () => window.clearInterval(timer);
  }, [isPlaying, years]);
  const graphDocuments = useMemo(() => visibleDocuments.filter((row) => documentStance === "all" || row.stance === documentStance), [visibleDocuments, documentStance]);
  const selectedDocument = selected?.type === "supporting" ? graphDocuments.find((row) => row.document_id === selected.value && row.concept === selected.concept) : undefined;
  const mainStatements = visibleStatements.filter((edge) => MAIN_NETWORK_ACTORS.has(actorName(edge)));
  const concepts = Object.keys(CONCEPT_LABELS);
  const selectedConcept = selected?.type === "concept" ? selected.value : selected?.concept;
  const centralityActors = useMemo(() => selectedConcept
    ? Array.from(new Set(visibleStatementFacets
        .filter((row) => row.concept === selectedConcept && ["support", "oppose"].includes(row.stance))
        .map((row) => row.actor)))
    : [], [visibleStatementFacets, selectedConcept]);
  const selectedSubconcept = selected?.type === "subconcept" ? selected.value : selected?.subconcept;
  const selectedSubconceptDefinition = subconceptNetwork.codebook.find((row) => row.concept === selectedConcept && row.subconcept === selectedSubconcept);
  const selectedRelations = !selected ? [] : visibleStatements.filter((edge) => {
    if (selected.type === "concept") return edge.concept === selected.value;
    if (selected.type === "supporting") return actorName(edge) === selected.value && edge.concept === selected.concept;
    return actorName(edge) === selected.value && (!selected.concept || edge.concept === selected.concept);
  });
  const selectedFacetRelations = selectedSubconcept ? visibleStatementFacets.filter((edge) => edge.concept === selectedConcept && edge.subconcept === selectedSubconcept) : [];
  const selectedPeers = !selected ? [] : selected.type === "subconcept"
    ? Array.from(new Set(selectedFacetRelations.filter((edge) => ["support", "oppose"].includes(edge.stance)).map((edge) => displayActorName(edge.actor)))).sort()
    : Array.from(new Set(selected.type === "concept"
      ? selectedRelations.filter((edge) => MAIN_NETWORK_ACTORS.has(actorName(edge))).map((edge) => displayActorName(actorName(edge)))
      : selectedRelations.map((edge) => CONCEPT_LABELS[edge.concept] || edge.concept))).sort();
  const issueDocuments = selectedConcept ? graphDocuments.filter((row) => row.concept === selectedConcept && (!selectedSubconcept || visibleDocumentFacets.some((facet) => facet.document_id === row.document_id && facet.concept === selectedConcept && facet.subconcept === selectedSubconcept))) : [];
  const metricRelations = selectedSubconcept ? selectedFacetRelations : selectedRelations;
  const selectedDocuments = new Set(metricRelations.map((edge) => edge.document_id)).size;
  const usesDocumentLayer = selected?.type === "concept" || selected?.type === "subconcept" || selected?.type === "supporting";
  const dossierDocuments = selectedDocument ? 1 : usesDocumentLayer ? issueDocuments.length : selectedDocuments;
  const dossierSupport = selectedDocument
    ? Number(selectedDocument.stance === "support")
    : usesDocumentLayer
      ? issueDocuments.filter((row) => row.stance === "support").length
      : new Set(metricRelations.filter((edge) => edge.stance === "support").map((edge) => edge.document_id)).size;
  const dossierOppose = selectedDocument
    ? Number(selectedDocument.stance === "oppose")
    : usesDocumentLayer
      ? issueDocuments.filter((row) => row.stance === "oppose").length
      : new Set(metricRelations.filter((edge) => edge.stance === "oppose").map((edge) => edge.document_id)).size;
  const dossierUnclear = selectedDocument
    ? Number(selectedDocument.stance === "unclear")
    : usesDocumentLayer
      ? issueDocuments.filter((row) => row.stance === "unclear").length
      : 0;
  const selectedStatementIds = new Set(selectedFacetRelations.map((row) => row.statement_id));
  const dossierStatements = Array.from(new Map((selected?.type === "subconcept"
    ? visibleStatements.filter((edge) => selectedStatementIds.has(edge.statement_id))
    : selected?.type === "concept" || selected?.type === "actor"
      ? selectedRelations
      : []).map((edge) => [edge.statement_id, edge])).values())
    .sort((left, right) => right.published_at.localeCompare(left.published_at));
  const visibleDossierStatements = dossierStatements.filter((edge) => dossierStance === "all" || edge.stance === dossierStance);
  const dossierStatementsByDocument = new Map<string, Edge[]>();
  dossierStatements.forEach((statement) => dossierStatementsByDocument.set(
    statement.document_id,
    [...(dossierStatementsByDocument.get(statement.document_id) || []), statement],
  ));
  const visibleDossierDocuments = usesDocumentLayer
    ? issueDocuments.filter((document) => dossierStance === "all" || document.stance === dossierStance)
    : [];
  const selectedProposition = selectedSubconceptDefinition?.proposition || (selectedConcept
    ? (visibleStatements.find((edge) => edge.concept === selectedConcept) || statements.find((edge) => edge.concept === selectedConcept))?.proposition
    : undefined);
  const updateFilter = (field: keyof typeof filters, value: string) => { setIsPlaying(false); setSelected(null); setFilters({ ...filters, [field]: value }); };
  return <>
    <PageLead tab="network" title="Jaringan wacana">Relasi aktor, konsep, dan posisi dalam korpus 2021–2024.</PageLead>
    <section className="network-observatory">
      <header>
        <div>
          <span>AKTOR · KONSEP · STANCE</span>
          <h2>Jaringan aktor dan konsep</h2>
          <p>Klik konsep untuk membuka subkonsep, aktor, dan dokumen yang membentuk perdebatan.</p>
          {excludedAuditCount > 0 && <small className="network-audit-note">{excludedAuditCount} pernyataan perlu pemeriksaan dan tidak dihitung pada graph.</small>}
        </div>
      </header>
      <div className="network-toolbar" aria-label="Filter jaringan">
        <div className="network-filter-row">
          <div className="network-year-filter">
            <span>Periode</span>
            <div role="group" aria-label="Tahun jaringan">
              <button className="coalition-play" aria-label={isPlaying ? "Jeda perubahan tahunan" : "Putar perubahan tahunan"} title={isPlaying ? "Jeda" : "Putar 2021–2024"} aria-pressed={isPlaying} onClick={() => { if (isPlaying) { setIsPlaying(false); return; } setFilters({ ...filters, year: years[0], eventId: "all" }); if (selected?.type === "supporting") setSelected(selected.concept ? { id: `concept:${selected.concept}`, type: "concept", value: selected.concept } : null); setIsPlaying(true); }}>
                {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              </button>
              {[...years, "all"].map((year) => <button key={year} aria-pressed={filters.year === year} onClick={() => { setIsPlaying(false); setFilters({ ...filters, year, eventId: "all" }); if (selected?.type === "supporting") setSelected(selected.concept ? { id: `concept:${selected.concept}`, type: "concept", value: selected.concept } : null); }}>{year === "all" ? "Semua" : year}</button>)}
            </div>
          </div>
          <SelectField label="Peristiwa" value={filters.eventId} onValueChange={(next) => updateFilter("eventId", next)}
            options={[{ value: "all", label: "Semua peristiwa" },
              ...events.map((event) => ({ value: event.event_id, label: event.event_name }))]} />
          <label>
            <span>Cari</span>
            <input value={filters.query} placeholder="Aktor atau konsep" onChange={(event) => updateFilter("query", event.target.value)} />
          </label>
          {selectedConcept && <SelectField label="Posisi dokumen" className="network-stance-filter"
            value={documentStance} onValueChange={setDocumentStance}
            options={[{ value: "all", label: "Semua posisi" }, { value: "support", label: "Support" },
              { value: "oppose", label: "Oppose" }, { value: "unclear", label: "Belum jelas" }]} />}
        </div>
        <div className="network-concept-picker" aria-label="Pilih konsep">
          <span>Konsep</span>
          {concepts.map((concept) => <button key={concept} aria-pressed={selectedConcept === concept} onClick={() => setSelected(selectedConcept === concept ? null : { id: `concept:${concept}`, type: "concept", value: concept })}>{CONCEPT_LABELS[concept]}</button>)}
        </div>
      </div>
      {visibleStatements.length === 0 && visibleDocuments.length === 0
        ? <EmptyState>Tidak ada relasi terkode pada filter ini. Ubah periode atau pencarian.</EmptyState>
        : <div className="observatory-body"><NetworkGraph documents={graphDocuments} codebook={subconceptNetwork.codebook} statementFacets={visibleStatementFacets} documentFacets={visibleDocumentFacets} statements={visibleStatements} actorUniverseStatements={contextualStatements} periodLabel={filters.year === "all" ? "2021–2024" : filters.year} selected={selected} onSelect={setSelected} /><aside className="node-dossier">
              <span className="dossier-label">DETAIL NODE</span>
              {selected ? <>
                <button className="node-back" onClick={() => setSelected(selected.type === "subconcept" ? { id: `concept:${selected.concept}`, type: "concept", value: selected.concept! } : null)}>
                  <ArrowLeft size={14} aria-hidden="true" /> {selected.type === "subconcept" ? "Kembali ke konsep" : "Kembali ke jaringan"}
                </button>
                <h3>{selected.type === "concept" ? CONCEPT_LABELS[selected.value] : selected.type === "subconcept" ? selectedSubconceptDefinition?.label || selected.value : selectedDocument ? (displayActorName(selectedDocument.author) || selectedDocument.title || "Dokumen tanpa nama akun") : displayActorName(selected.value)}</h3>
                {selectedSubconceptDefinition && <p>{selectedSubconceptDefinition.description}</p>}
                {selectedProposition && <section className="dossier-proposition">
                  <span>{selectedSubconceptDefinition ? "Proposisi subkonsep" : "Proposisi konsep"}</span>
                  <p>{selectedProposition}</p>
                </section>}
                {selectedDocument && <div className="issue-document">
                  <p>{selectedDocument.published_at.slice(0, 10)} · {selectedDocument.platform}</p>
                  {distributionLabel(selectedDocument.repost_type, selectedDocument.repost_source) && <span className={`distribution-badge ${selectedDocument.repost_type}`}>{distributionLabel(selectedDocument.repost_type, selectedDocument.repost_source)}</span>}
                  <strong>{selectedDocument.stance === "unclear" ? "Posisi belum jelas" : selectedDocument.stance}</strong>
                  <p>{selectedDocument.statement_text}</p>
                  {selectedDocument.url && <a href={selectedDocument.url} target="_blank" rel="noreferrer">Buka sumber</a>}
                  <small>Prediksi model pada cuplikan; bukan atribusi sikap akun.</small>
                </div>}
                {!selectedSubconceptDefinition && !selectedDocument && <p>{selected.type === "actor" ? "Aktor utama dalam jaringan." : "Pilih subkonsep untuk membuka rincian perdebatan."}</p>}
                <dl className="node-metrics">
                  <div><dt>Dokumen</dt><dd>{dossierDocuments}</dd></div>
                  <div><dt>Support</dt><dd>{dossierSupport}</dd></div>
                  <div><dt>Oppose</dt><dd>{dossierOppose}</dd></div>
                  <div><dt>Belum jelas</dt><dd>{dossierUnclear}</dd></div>
                </dl>
                {!selectedDocument && <>
                  <div className="node-peers">
                    <span>{selected.type === "concept" || selected.type === "subconcept" ? "Aktor utama terkait" : "Konsep terkait"}</span>
                    <p>{selectedPeers.slice(0, 10).join(" · ") || "Belum ada hubungan stance pada filter ini."}</p>
                  </div>
                  <section className="node-statements">
                    <header>
                      <div><span>{usesDocumentLayer ? "Dokumen dan pernyataan" : "Pernyataan aktor"}</span><small>{usesDocumentLayer ? visibleDossierDocuments.length : visibleDossierStatements.length} dari {usesDocumentLayer ? issueDocuments.length : dossierStatements.length}</small></div>
                      <div role="group" aria-label="Filter posisi pernyataan">
                        {["all", "support", "oppose", ...(usesDocumentLayer ? ["unclear"] : [])].map((stance) => <button key={stance} aria-pressed={dossierStance === stance} onClick={() => setDossierStance(stance)}>{stance === "all" ? "Semua" : stance === "unclear" ? "Belum jelas" : stance}</button>)}
                      </div>
                    </header>
                    <div className="node-statement-list">
                      {usesDocumentLayer && visibleDossierDocuments.slice(0, 100).map((document) => {
                        const attributedStatements = dossierStatementsByDocument.get(document.document_id) || [];
                        return <article key={document.document_id}>
                          <div><span className={`stance-tag ${document.stance}`}>{document.stance === "unclear" ? "belum jelas" : document.stance}</span><time>{document.published_at.slice(0, 10)}</time></div>
                          {distributionLabel(document.repost_type, document.repost_source) && <span className={`distribution-badge ${document.repost_type}`}>{distributionLabel(document.repost_type, document.repost_source)}</span>}
                          <strong>{attributedStatements.length > 0 ? Array.from(new Set(attributedStatements.map((statement) => displayActorName(statement.actor)))).join(" · ") : displayActorName(document.author) || document.title || "Dokumen tanpa nama akun"}</strong>
                          <small>{document.platform} · {CONCEPT_LABELS[document.concept] || document.concept}</small>
                          {attributedStatements.length > 0
                            ? attributedStatements.map((statement) => <div className="attributed-quote" key={`${statement.statement_id}:${statement.concept}:${statement.proposition}`}><b>{displayActorName(statement.actor)}</b><small className="evidence-kind">{statementEvidenceLabel(statement)}</small><blockquote>{statement.statement_text}</blockquote></div>)
                            : <blockquote>{document.statement_text}</blockquote>}
                          {document.url && <a href={document.url} target="_blank" rel="noreferrer">Sumber asli <ArrowUpRight size={13} aria-hidden="true" /></a>}
                        </article>;
                      })}
                      {!usesDocumentLayer && visibleDossierStatements.map((statement) => <article key={statement.statement_id}>
                        <div><span className={`stance-tag ${statement.stance}`}>{statement.stance}</span><time>{statement.published_at.slice(0, 10)}</time></div>
                        <strong>{displayActorName(statement.actor)}</strong>
                        <small>{CONCEPT_LABELS[statement.concept] || statement.concept}</small>
                        <small className="evidence-kind">{statementEvidenceLabel(statement)}</small>
                        {selected?.type === "actor" && <p className="statement-proposition">{statement.proposition}</p>}
                        <blockquote>{statement.statement_text}</blockquote>
                        {statement.url && <a href={statement.url} target="_blank" rel="noreferrer">Sumber asli <ArrowUpRight size={13} aria-hidden="true" /></a>}
                      </article>)}
                      {(usesDocumentLayer ? visibleDossierDocuments.length : visibleDossierStatements.length) === 0 && <p className="node-statements-empty">Tidak ada dokumen pada posisi ini.</p>}
                      {usesDocumentLayer && visibleDossierDocuments.length > 100 && <p className="node-statements-limit">Menampilkan 100 dokumen pertama. Gunakan filter waktu atau peristiwa untuk mempersempit hasil.</p>}
                    </div>
                  </section>
                </>}
              </> : <div className="dossier-empty">
                <span>○</span>
                <h3>Pilih node</h3>
                <p>Pilih aktor atau konsep untuk membuka jaringan rinci.</p>
              </div>}
            </aside></div>}
    </section>
      {selectedConcept && <ConceptCentrality concept={selectedConcept} statements={visibleStatementFacets} codebook={subconceptNetwork.codebook} actorUniverse={centralityActors} displayName={displayActorName} onSelectActor={(actor) => { setSelected({ id: `actor:${actor}`, type: "actor", value: actor, concept: selectedConcept }); document.querySelector(".network-observatory")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />}
      <NetworkTables statements={mainStatements} actorName={actorName} displayName={displayActorName} onSelectActor={(actor) => { setSelected({ id: `actor:${actor}`, type: "actor", value: actor }); document.querySelector(".network-observatory")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
  </>;
}

function windowDays(event: EventWindow | undefined) {
  if (!event) return 0;
  const start = new Date(`${event.start_date}T00:00:00Z`).getTime();
  const end = new Date(`${event.end_date}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000) + 1;
}

function ComparisonTab({ edges, events }: { edges: Edge[]; events: EventWindow[] }) {
  const compositionRef = useRef<HTMLElement | null>(null);
  const coalitionRef = useRef<HTMLElement | null>(null);
  type Position = "support" | "oppose" | "mixed" | "absent";
  const usableEdges = useMemo(() => edges.filter((edge) => edge.network_included !== false), [edges]);
  const years = useMemo(() => Array.from(new Set(usableEdges.map((edge) => String(edge.year)))).sort(), [usableEdges]);
  const yearOptions = ["all", ...years];
  const [yearA, setYearA] = useState(years[0] || "2021");
  const [yearB, setYearB] = useState(years[1] || years[0] || "2022");
  const [eventA, setEventA] = useState("all");
  const [eventB, setEventB] = useState("all");
  const [selectedCell, setSelectedCell] = useState<{ actor: string; concept: string } | null>(null);
  const resolvedYearA = yearOptions.includes(yearA) ? yearA : years[0] || "all";
  const resolvedYearB = yearOptions.includes(yearB) ? yearB : years[1] || years[0] || "all";
  const eventsForYear = (year: string) => events.filter((event) => year === "all" || event.start_date.slice(0, 4) === year);
  const eventOptionsA = eventsForYear(resolvedYearA);
  const eventOptionsB = eventsForYear(resolvedYearB);
  const resolvedEventA = eventOptionsA.some((event) => event.event_id === eventA) ? eventA : "all";
  const resolvedEventB = eventOptionsB.some((event) => event.event_id === eventB) ? eventB : "all";
  const periodRows = (year: string, eventId: string) => usableEdges.filter((edge) =>
    (year === "all" || String(edge.year) === year) && (eventId === "all" || edge.event_id === eventId)
  );
  const a = periodRows(resolvedYearA, resolvedEventA);
  const b = periodRows(resolvedYearB, resolvedEventB);
  const concepts = Object.keys(CONCEPT_LABELS);
  const positionFor = (rows: Edge[], actor: string, concept: string): Position => {
    const stances = new Set(rows.filter((edge) => actorName(edge) === actor && edge.concept === concept).map((edge) => edge.stance));
    if (stances.size === 0) return "absent";
    return stances.size > 1 ? "mixed" : stances.has("support") ? "support" : "oppose";
  };
  const periodFor = (year: string, eventId: string) => {
    const event = events.find((item) => item.event_id === eventId);
    if (event) return { label: event.event_name, start_date: event.start_date, end_date: event.end_date };
    return year === "all"
      ? { label: "Semua tahun", start_date: "2021-01-01", end_date: "2024-12-31" }
      : { label: `Tahun ${year}`, start_date: `${year}-01-01`, end_date: `${year}-12-31` };
  };
  const summaryFor = (rows: Edge[], year: string, eventId: string) => {
    const period = periodFor(year, eventId);
    const days = windowDays({ event_id: eventId, event_name: period.label, start_date: period.start_date, end_date: period.end_date, selection_basis: "" });
    return { days, statements: rows.length, actors: new Set(rows.map(actorName)).size, documents: new Set(rows.map((edge) => edge.document_id)).size };
  };
  const summaryA = summaryFor(a, resolvedYearA, resolvedEventA);
  const summaryB = summaryFor(b, resolvedYearB, resolvedEventB);
  const actorRows = Array.from(new Set([...a.map(actorName), ...b.map(actorName)]))
    .map((actor) => ({ actor, total: a.filter((edge) => actorName(edge) === actor).length + b.filter((edge) => actorName(edge) === actor).length }))
    .sort((left, right) => right.total - left.total || left.actor.localeCompare(right.actor)).slice(0, 15);
  /**
   * Pergeseran posisi per konsep, dibaca sebagai satu baris per konsep.
   *
   * Rancangan sebelumnya memakai batang bertumpuk 100% dengan dua baris per konsep.
   * Bentuk itu menyembunyikan dua hal yang justru menentukan di sini: besaran bukti
   * dan arah perubahan. Satu relasi tergambar sebagai batang penuh selebar layar,
   * tidak terbedakan dari 175 relasi, dan baris tanpa observasi terlihat sama
   * dengan posisi nol. Keduanya melanggar aturan denominator proyek ini.
   *
   * Bentuk sekarang: sumbu keseimbangan posisi dari -1 (seluruhnya menolak) ke
   * +1 (seluruhnya mendukung), titik A berongga menuju titik B terisi, luas titik
   * sebanding dengan jumlah relasi. Perubahan terbaca sebagai satu anak panah,
   * dan bukti yang tipis tampak sebagai titik kecil di ujung sumbu.
   */
  const conceptChange = concepts.map((concept) => {
    const count = (rows: Edge[], stance: "support" | "oppose") =>
      rows.filter((edge) => edge.concept === concept && edge.stance === stance).length;
    const supportA = count(a, "support"), opposeA = count(a, "oppose");
    const supportB = count(b, "support"), opposeB = count(b, "oppose");
    const totalA = supportA + opposeA, totalB = supportB + opposeB;
    return {
      concept, label: CONCEPT_LABELS[concept],
      supportA, opposeA, supportB, opposeB, totalA, totalB,
      balanceA: totalA ? (supportA - opposeA) / totalA : null,
      balanceB: totalB ? (supportB - opposeB) / totalB : null,
    };
  }).sort((left, right) => {
    // Konsep yang teramati pada kedua periode didahulukan, lalu perubahan terbesar.
    const rank = (row: typeof left) => (row.totalA && row.totalB ? 0 : row.totalA || row.totalB ? 1 : 2);
    const shift = (row: typeof left) => row.balanceA !== null && row.balanceB !== null
      ? Math.abs(row.balanceB - row.balanceA) : -1;
    return rank(left) - rank(right) || shift(right) - shift(left) || left.label.localeCompare(right.label);
  });

  const SHIFT_COLORS = { support: "#087554", oppose: "#c53927", flat: "#6b7280" };
  const dotRadius = (total: number) => Math.max(4, Math.min(15, 3.4 + Math.sqrt(total) * 1.55));
  const shiftTone = (row: typeof conceptChange[number]) => {
    if (row.balanceA === null || row.balanceB === null) return SHIFT_COLORS.flat;
    if (row.balanceB > row.balanceA) return SHIFT_COLORS.support;
    if (row.balanceB < row.balanceA) return SHIFT_COLORS.oppose;
    return SHIFT_COLORS.flat;
  };
  const stanceSummary = (total: number, support: number, oppose: number) =>
    total ? `${formatNumber(total)} relasi · ${support} mendukung, ${oppose} menolak` : "tidak teramati";

  const compareOption = {
    animationDurationUpdate: 360,
    aria: { enabled: true, description: "Pergeseran keseimbangan posisi tiap konsep dari periode A ke periode B." },
    tooltip: {
      trigger: "item",
      formatter: (item: { dataIndex: number }) => {
        const row = conceptChange[item.dataIndex];
        if (!row) return "";
        const move = row.balanceA !== null && row.balanceB !== null
          ? `<br/>Pergeseran: <b>${(row.balanceB - row.balanceA) > 0 ? "+" : ""}${(row.balanceB - row.balanceA).toFixed(2)}</b> pada skala −1…+1`
          : "<br/>Hanya teramati pada satu periode; pergeseran tidak dapat dihitung.";
        return `<b>${row.label}</b><br/>A: ${stanceSummary(row.totalA, row.supportA, row.opposeA)}`
          + `<br/>B: ${stanceSummary(row.totalB, row.supportB, row.opposeB)}${move}`;
      },
    },
    grid: { left: 142, right: 132, top: 26, bottom: 46 },
    xAxis: {
      type: "value", min: -1.08, max: 1.08,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        color: "#6b7280", fontSize: 10,
        formatter: (value: number) => Math.abs(value + 1) < 0.01 ? "seluruhnya menolak"
          : Math.abs(value) < 0.01 ? "berimbang"
          : Math.abs(value - 1) < 0.01 ? "seluruhnya mendukung" : "",
      },
      splitLine: { lineStyle: { color: "#e4e0d6" } },
    },
    yAxis: {
      type: "category", inverse: true, data: conceptChange.map((row) => row.label),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: "#3f4854", fontSize: 11, margin: 14 },
      splitLine: { show: true, lineStyle: { color: "#efece4" } },
    },
    series: [{
      type: "custom",
      // Satu grup per konsep: penghubung, anak panah, dua titik, dan angka di kanan.
      renderItem: (params: { dataIndex: number }, api: { coord: (point: number[]) => number[]; size: (value: number[]) => number[] }) => {
        const row = conceptChange[params.dataIndex];
        const y = api.coord([0, params.dataIndex])[1];
        const right = api.coord([1.08, params.dataIndex])[0];
        const tone = shiftTone(row);
        const children: unknown[] = [];

        if (!row.totalA && !row.totalB) {
          children.push({ type: "text", style: { x: api.coord([0, params.dataIndex])[0], y, text: "tidak teramati pada kedua periode",
            textAlign: "center", textVerticalAlign: "middle", fill: "#9aa0a9", font: "500 10px Inter, sans-serif" } });
          return { type: "group", children };
        }

        const xa = row.balanceA !== null ? api.coord([row.balanceA, params.dataIndex])[0] : null;
        const xb = row.balanceB !== null ? api.coord([row.balanceB, params.dataIndex])[0] : null;
        if (!row.totalA || !row.totalB) {
          const left = api.coord([-1.08, params.dataIndex])[0];
          children.push({ type: "line", shape: { x1: left, y1: y, x2: right, y2: y },
            style: { stroke: "#c9c4b9", lineWidth: 1, lineDash: [2, 4] } });
        }

        // Kedua titik berimpit: tanpa penanganan khusus titik B menutupi titik A,
        // sehingga "tidak bergeser" menjadi tidak terlihat sama sekali.
        const settled = xa !== null && xb !== null && Math.abs(xb - xa) <= 1;

        if (xa !== null && xb !== null && !settled) {
          children.push({ type: "line", shape: { x1: xa, y1: y, x2: xb, y2: y },
            style: { stroke: tone, lineWidth: 2.4, opacity: .55 } });
          const direction = xb > xa ? 1 : -1;
          const tip = xb - direction * dotRadius(row.totalB);
          children.push({ type: "polygon", shape: { points: [[tip, y], [tip - direction * 8, y - 4.6], [tip - direction * 8, y + 4.6]] },
            style: { fill: tone } });
        }
        if (xa !== null) {
          const radius = settled ? Math.max(dotRadius(row.totalA), dotRadius(row.totalB)) + 4.5 : dotRadius(row.totalA);
          children.push({ type: "circle", shape: { cx: xa, cy: y, r: radius },
            style: { fill: "#fffdf7", stroke: "#59616e", lineWidth: 1.6 } });
        }
        if (xb !== null) {
          children.push({ type: "circle", shape: { cx: xb, cy: y, r: dotRadius(row.totalB) },
            style: { fill: tone, stroke: "#fffdf7", lineWidth: 1.4 } });
        }
        // Denominator selalu ikut terbaca, tidak hanya di tooltip.
        children.push({ type: "text", style: { x: right + 12, y, textAlign: "left", textVerticalAlign: "middle",
          text: `${row.totalA || "–"} → ${row.totalB || "–"} relasi`,
          fill: "#6b7280", font: "600 10px ui-monospace, SFMono-Regular, monospace" } });
        return { type: "group", children };
      },
      data: conceptChange.map((row, index) => [index, row.balanceA ?? 0]),
    }],
  };
  const coalitionActors = actorRows.slice(0, 10).map((row) => row.actor);
  const relationScore = (left: string, right: string, rows: Edge[]) => concepts.reduce((score, concept) => {
    const leftPosition = positionFor(rows, left, concept); const rightPosition = positionFor(rows, right, concept);
    if (["absent", "mixed"].includes(leftPosition) || ["absent", "mixed"].includes(rightPosition)) return score;
    return score + (leftPosition === rightPosition ? 1 : -1);
  }, 0);
  const coalitionHeatmap = coalitionActors.flatMap((left, y) => coalitionActors.map((right, x) => [x, y, relationScore(left, right, b) - relationScore(left, right, a)]));
  const coalitionOption = {
    animationDurationUpdate: 360,
    aria: { enabled: true, description: "Perubahan keselarasan posisi pasangan aktor dari A ke B." },
    tooltip: { formatter: (item: { value: [number, number, number] }) => `${displayActorName(coalitionActors[item.value[1]])} × ${displayActorName(coalitionActors[item.value[0]])}<br/><b>${item.value[2] > 0 ? "+" : ""}${item.value[2]}</b> perubahan keselarasan` },
    grid: { left: 148, right: 28, top: 14, bottom: 112 },
    xAxis: { type: "category", data: coalitionActors.map(displayActorName), axisLabel: { rotate: 38, interval: 0, fontSize: 9 } },
    yAxis: { type: "category", data: coalitionActors.map(displayActorName), inverse: true, axisLabel: { fontSize: 10 } },
    visualMap: { min: -4, max: 4, calculable: false, orient: "horizontal", left: "center", bottom: 4, text: ["lebih selaras", "lebih berseberangan"], inRange: { color: ["#c53927", "#f4f1e9", "#087554"] } },
    series: [{ type: "heatmap", data: coalitionHeatmap, label: { show: false }, itemStyle: { borderColor: "#f9f7f0", borderWidth: 2 } }],
  };
  const selectedEvidence = selectedCell ? {
    a: a.filter((edge) => actorName(edge) === selectedCell.actor && edge.concept === selectedCell.concept).slice(0, 2),
    b: b.filter((edge) => actorName(edge) === selectedCell.actor && edge.concept === selectedCell.concept).slice(0, 2),
  } : null;
  const periodLabel = (year: string, eventId: string) => periodFor(year, eventId).label;
  const periodDate = (year: string, eventId: string) => { const period = periodFor(year, eventId); return formatDateRange(period.start_date, period.end_date); };
  const positionLabel = (position: Position) => position === "support" ? "S" : position === "oppose" ? "O" : position === "mixed" ? "C" : "-";

  return <>
    <PageLead tab="compare" title="Perbandingan posisi">
      Tahun menjadi konteks utama; peristiwa mempersempit pembacaan pada episode kontestasi tertentu.
    </PageLead>
    <section className="compare-controls" aria-label="Atur perbandingan">
      <article className="compare-period-control"><span>PERIODE A</span>
        <SelectField label="Tahun" value={resolvedYearA} onValueChange={(next) => { setYearA(next); setEventA("all"); setSelectedCell(null); }}
          options={yearOptions.map((year) => ({ value: year, label: year === "all" ? "Semua tahun" : year }))} />
        <SelectField label="Fokus peristiwa" value={resolvedEventA} onValueChange={(next) => { setEventA(next); setSelectedCell(null); }}
          options={[{ value: "all", label: "Seluruh tahun" }, ...eventOptionsA.map((item) => ({ value: item.event_id, label: item.event_name }))]} />
      </article>
      <button className="compare-swap" aria-label="Tukar periode A dan B" onClick={() => { setYearA(resolvedYearB); setYearB(resolvedYearA); setEventA(resolvedEventB); setEventB(resolvedEventA); setSelectedCell(null); }}>⇄</button>
      <article className="compare-period-control"><span>PERIODE B</span>
        <SelectField label="Tahun" value={resolvedYearB} onValueChange={(next) => { setYearB(next); setEventB("all"); setSelectedCell(null); }}
          options={yearOptions.map((year) => ({ value: year, label: year === "all" ? "Semua tahun" : year }))} />
        <SelectField label="Fokus peristiwa" value={resolvedEventB} onValueChange={(next) => { setEventB(next); setSelectedCell(null); }}
          options={[{ value: "all", label: "Seluruh tahun" }, ...eventOptionsB.map((item) => ({ value: item.event_id, label: item.event_name }))]} />
      </article>
    </section>
    <section className="comparison-coverage">
      {[{ year: resolvedYearA, eventId: resolvedEventA, summary: summaryA, letter: "A" }, { year: resolvedYearB, eventId: resolvedEventB, summary: summaryB, letter: "B" }].map(({ year, eventId, summary, letter }) => <article key={letter}>
        <div><span className="comparison-letter">{letter}</span><strong>{periodLabel(year, eventId)}</strong><small>{periodDate(year, eventId)} · {summary.days} hari</small></div>
        <dl><div><dt>Pernyataan</dt><dd>{formatNumber(summary.statements)}</dd></div><div><dt>Dokumen</dt><dd>{formatNumber(summary.documents)}</dd></div><div><dt>Aktor</dt><dd>{formatNumber(summary.actors)}</dd></div></dl>
      </article>)}
    </section>
    <p className="compare-note">Unit analisis: pernyataan aktor–konsep yang masuk jaringan. Tidak ada pernyataan tidak dibaca sebagai posisi netral atau perubahan posisi.</p>
    <section className="comparison-figure" ref={compositionRef}>
      <header className="comparison-section-head"><span>FIG. 05</span><div><h2>Pergeseran posisi per konsep</h2><p>Titik berongga adalah periode A, titik terisi periode B; luas titik sebanding dengan jumlah relasi.</p></div><div className="shift-legend"><span><i className="dot-a" /> Periode A</span><span><i className="dot-b" /> Periode B</span><span><i className="shift-support" /> bergeser mendukung</span><span><i className="shift-oppose" /> bergeser menolak</span></div></header>
      <ReactECharts option={compareOption} style={{ height: 336 }} />
      <p className="compare-axis-note">Sumbu membaca keseimbangan posisi di dalam satu konsep, bukan volume. Konsep dengan sedikit relasi tetap dapat mencapai ujung sumbu, sehingga ukuran titik dan angka di kanan perlu dibaca bersamaan. Tanda – berarti konsep tidak teramati pada periode itu, ditandai pula dengan garis putus-putus.</p>
      <FigureActions targetRef={compositionRef} name="Pergeseran posisi per konsep" />
    </section>
    <section className="position-matrix">
      <header className="comparison-section-head"><span>AKTOR</span><div><h2>Perubahan posisi aktor</h2><p>Pilih sel untuk membuka kutipan pernyataan pada kedua periode.</p></div><div className="matrix-key">S support · O oppose · C campuran · - belum teramati</div></header>
      <div className="compare-matrix-scroll"><table><thead><tr><th>Aktor</th>{concepts.map((concept) => <th key={concept}>{CONCEPT_LABELS[concept]}</th>)}</tr></thead><tbody>{actorRows.map(({ actor }) => <tr key={actor}><th>{displayActorName(actor)}</th>{concepts.map((concept) => { const before = positionFor(a, actor, concept); const after = positionFor(b, actor, concept); const active = selectedCell?.actor === actor && selectedCell.concept === concept; return <td key={concept}><button className={`position-cell ${active ? "selected" : ""}`} aria-label={`${displayActorName(actor)}, ${CONCEPT_LABELS[concept]}: ${positionLabel(before)} ke ${positionLabel(after)}`} onClick={() => setSelectedCell({ actor, concept })}><span className={before}>{positionLabel(before)}</span><b>→</b><span className={after}>{positionLabel(after)}</span></button></td>; })}</tr>)}</tbody></table></div>
      {selectedCell && <div className="comparison-evidence"><header><div><span>BUKTI PERNYATAAN</span><h3>{displayActorName(selectedCell.actor)} · {CONCEPT_LABELS[selectedCell.concept]}</h3></div><button onClick={() => setSelectedCell(null)}>Tutup</button></header><div className="comparison-evidence-columns">{([{ label: "A", rows: selectedEvidence?.a || [], period: periodLabel(resolvedYearA, resolvedEventA) }, { label: "B", rows: selectedEvidence?.b || [], period: periodLabel(resolvedYearB, resolvedEventB) }]).map((column) => <section key={column.label}><span>{column.label} · {column.period}</span>{column.rows.length === 0 ? <p>Belum ada pernyataan terkode.</p> : column.rows.map((edge) => <article key={edge.statement_id}><b className={edge.stance}>{edge.stance}</b><p>{edge.proposition}</p><blockquote>{edge.statement_text}</blockquote><small>{formatDateRange(edge.published_at, edge.published_at)}</small>{edge.url && <a href={edge.url} target="_blank" rel="noreferrer">Sumber asli <ArrowUpRight size={12} aria-hidden="true" /></a>}</article>)}</section>)}</div></div>}
    </section>
    <section className="coalition-figure" ref={coalitionRef}>
      <header className="comparison-section-head"><span>RELASI</span><div><h2>Perubahan keselarasan aktor</h2><p>Perubahan kesamaan atau perbedaan posisi pada konsep yang sama, dari A ke B.</p></div></header>
      {coalitionActors.length < 2 ? <p className="comparison-empty">Belum cukup aktor yang teramati pada dua periode ini.</p> : <><ReactECharts option={coalitionOption} style={{ height: 420 }} /><FigureActions targetRef={coalitionRef} name="Perubahan keselarasan aktor" /></>}
    </section>
  </>;
}

function NetworkPending({ failed }: { failed: boolean }) {
  return <>
    <PageLead tab="network" title="Jaringan wacana">Relasi aktor, konsep, dan posisi dalam korpus 2021–2024.</PageLead>
    <div className="empty-state">
      <span>{failed ? "!" : "◍"}</span>
      <strong>{failed ? "Data jaringan gagal dimuat" : "Memuat data jaringan"}</strong>
      <p>{failed
        ? "Periksa document_concepts.json dan subconcept_network.json pada public/data."
        : "Konsep tingkat dokumen dan subkonsep sedang dimuat."}</p>
    </div>
  </>;
}

export default function Dashboard({ dataset }: { dataset: Dataset }) {
  // A cited link carries its tab and evidence filters, so both are seeded from the
  // query string; the effect below keeps the tab parameter current afterwards.
  const [tab, setTab] = useState<TabId>(() => {
    const urlTab = readUrlParams().get("tab");
    return TABS.some((entry) => entry.id === urlTab) ? urlTab as TabId : "corpus";
  });
  const [overviewFilters, setOverviewFilters] = useState<OverviewState>(INITIAL_OVERVIEW_FILTERS);
  const [evidenceFilters, setEvidenceFilters] = useState<Filters>(evidenceFiltersFromUrl);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("wacana-haji:sidebar") === "collapsed"; } catch { return false; }
  });
  const [networkData, setNetworkData] = useState<NetworkDataset | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);
  const networkRequested = useRef(false);
  const [evidenceDocuments, setEvidenceDocuments] = useState<EvidenceDocument[] | null>(null);
  const [evidenceFailed, setEvidenceFailed] = useState(false);
  const evidenceRequested = useRef(false);

  useEffect(() => { writeUrlParams({ tab: tab === "corpus" ? null : tab }); }, [tab]);

  useEffect(() => {
    try { window.localStorage.setItem("wacana-haji:sidebar", sidebarCollapsed ? "collapsed" : "expanded"); } catch { /* penyimpanan diblokir */ }
  }, [sidebarCollapsed]);

  // The network tables are ~11 MB, so they load after first paint: on idle if the
  // reader stays on another tab, immediately when they open the network tab.
  useEffect(() => {
    if (networkData || networkFailed) return;
    const start = () => {
      if (networkRequested.current) return;
      networkRequested.current = true;
      Promise.all([
        fetch("/data/document_concepts.json").then((response) => response.ok ? response.json() : []),
        fetch("/data/subconcept_network.json").then((response) =>
          response.ok ? response.json() : { codebook: [], statementEdges: [], documentEdges: [] }),
      ])
        .then(([documentConcepts, subconceptNetwork]) => setNetworkData({ documentConcepts, subconceptNetwork }))
        .catch(() => setNetworkFailed(true));
    };
    if (tab === "network") {
      start();
      return;
    }
    const idle = window.requestIdleCallback?.(start, { timeout: 4000}) ?? window.setTimeout(start, 1500);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle as number);
      else window.clearTimeout(idle as number);
    };
  }, [tab, networkData, networkFailed]);

  useEffect(() => {
    if (tab !== "evidence" || evidenceDocuments || evidenceRequested.current) return;
    evidenceRequested.current = true;
    fetch("/data/documents.json")
      .then((response) => {
        if (!response.ok) throw new Error("documents.json unavailable");
        return response.json() as Promise<EvidenceDocument[]>;
      })
      .then(setEvidenceDocuments)
      .catch(() => setEvidenceFailed(true));
  }, [tab, evidenceDocuments]);

  const filteredCorpus = dataset.corpus.filter((row) =>
    inRange(row.published_at, overviewFilters) &&
    (overviewFilters.channel === "all" || row.channel === overviewFilters.channel),
  );
  const overviewEdges = dataset.documentEdges.filter((edge) =>
    inRange(edge.published_at, overviewFilters) &&
    (overviewFilters.channel === "all" || edge.channel === overviewFilters.channel),
  );

  return <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
    <Sidebar tab={tab} setTab={setTab} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
    <section className="workspace">
      <div className="running-head">
        <span>RISET WACANA PEMBIAYAAN HAJI</span>
        <span>{PAGE_META[tab].number} · {PAGE_META[tab].label}</span>
        <span>DISCOURSE NETWORK ANALYSIS</span>
      </div>
      <div className={`page-content page-${tab}`}>
        {tab === "corpus" && <CorpusTab corpus={filteredCorpus} edges={overviewEdges} events={dataset.events} filters={overviewFilters} setFilters={setOverviewFilters} />}
        {tab === "network" && (networkData
          ? <NetworkTab documentConcepts={networkData.documentConcepts} subconceptNetwork={networkData.subconceptNetwork} corpus={dataset.corpus} statements={dataset.statements} events={dataset.events} />
          : <NetworkPending failed={networkFailed} />)}
        {tab === "compare" && <ComparisonTab edges={dataset.statements} events={dataset.events} />}
        {tab === "evidence" && (evidenceDocuments
          ? <EvidenceTab documents={evidenceDocuments} statements={dataset.statements} filters={evidenceFilters} setFilters={setEvidenceFilters} events={dataset.events} />
          : <EvidencePending failed={evidenceFailed} />)}
      </div>
    </section>
  </main>;
}
