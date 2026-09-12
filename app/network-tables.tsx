"use client";

import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { FigureActions } from "./figure-actions";
import { calculateConceptCentrality, calculateNetworkMetrics } from "./network-metrics";
import { CONCEPT_LABELS, type Edge, type StatementSubconcept, type SubconceptDefinition } from "./dashboard-model";

const score = (value: number) => value.toLocaleString("id-ID", { maximumFractionDigits: 3 });
const tabs = ["Aktor–konsep", "Congruence & conflict", "Metrik aktor"] as const;

export function ConceptCentrality({ concept, statements, codebook, actorUniverse, displayName, onSelectActor }: {
  concept: string;
  statements: StatementSubconcept[];
  codebook: SubconceptDefinition[];
  actorUniverse: string[];
  displayName: (actor: string) => string;
  onSelectActor: (actor: string) => void;
}) {
  type Metric = "strength" | "degreeNormalized" | "harmonic" | "betweenness";
  const [metric, setMetric] = useState<Metric>("strength");
  const subconcepts = useMemo(() => codebook.filter(row => row.concept === concept).map(row => row.subconcept), [codebook, concept]);
  const rows = useMemo(() => calculateConceptCentrality(
    statements.map(row => ({ ...row, actor: row.actor })), concept, subconcepts, actorUniverse,
  ), [statements, concept, subconcepts, actorUniverse]);
  const ranked = [...rows].sort((a, b) => b[metric] - a[metric] || b.strength - a.strength || a.actor.localeCompare(b.actor));
  const metricLabel = { strength: "Strength", degreeNormalized: "Degree", harmonic: "Harmonic", betweenness: "Betweenness" }[metric];
  const max = Math.max(...ranked.map(row => row[metric]), 0);
  return <section className="concept-centrality">
    <header><div><span>CENTRALITY / {CONCEPT_LABELS[concept]}</span><h2>Posisi aktor dalam konsep</h2><p>Jaringan aktor-subkonsep pada periode yang dipilih.</p></div>
      <div className="centrality-tabs" role="group" aria-label="Urutkan centrality">{(["strength", "degreeNormalized", "harmonic", "betweenness"] as Metric[]).map(item => <button key={item} aria-pressed={metric === item} onClick={() => setMetric(item)}>{{ strength: "Strength", degreeNormalized: "Degree", harmonic: "Harmonic", betweenness: "Betweenness" }[item]}</button>)}</div>
    </header>
    {ranked.length ? <div className="centrality-table-wrap"><table><caption>Peringkat berdasarkan {metricLabel}. Support dan oppose dihitung sebagai dokumen unik.</caption><thead><tr><th>Peringkat</th><th>Aktor</th><th>{metricLabel}</th><th>Degree</th><th>Strength</th><th>Harmonic</th><th>Betweenness</th><th>Support</th><th>Oppose</th></tr></thead><tbody>{ranked.map((row, index) => <tr key={row.actor}><td>{index + 1}</td><th scope="row"><button onClick={() => onSelectActor(row.actor)}>{displayName(row.actor)}</button></th><td><div className="centrality-score"><i style={{ width: `${max ? row[metric] / max * 100 : 0}%` }} /><b>{score(row[metric])}</b></div></td><td>{row.degree}/{subconcepts.length}</td><td>{row.strength}</td><td>{score(row.harmonic)}</td><td>{score(row.betweenness)}</td><td className="dna-positive">{row.support}</td><td className="dna-negative">{row.oppose}</td></tr>)}</tbody></table></div> : <p className="dna-empty">Belum ada relasi aktor-subkonsep terkode pada filter ini.</p>}
    <details><summary>Arti metrik</summary><p><b>Degree</b> adalah proporsi subkonsep yang dijangkau. <b>Strength</b> adalah jumlah dokumen unik per relasi aktor-subkonsep dan posisi. <b>Harmonic</b> mengukur jangkauan pada jaringan yang dapat terputus. <b>Betweenness</b> menandai aktor yang berada pada jalur penghubung antarsubkonsep. Nilai dinormalisasi terhadap aktor dengan relasi terkode pada filter aktif dan codebook subkonsep yang tetap.</p><p>Ukuran ini menunjukkan posisi struktural dalam data terkode; bukan ukuran kekuasaan, pengaruh, atau bukti hegemoni.</p></details>
  </section>;
}

export function NetworkTables({ statements, actorName, displayName, onSelectActor }: {
  statements: Edge[];
  actorName: (edge: Edge) => string;
  displayName: (actor: string) => string;
  onSelectActor: (actor: string) => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const [projection, setProjection] = useState<"congruence" | "conflict">("congruence");
  const heatmapRef = useRef<HTMLDivElement | null>(null);
  const concepts = Object.keys(CONCEPT_LABELS);
  const metrics = useMemo(() => calculateNetworkMetrics(statements.map(row => ({ ...row, actor: actorName(row) })), Object.keys(CONCEPT_LABELS)), [statements, actorName]);
  const actorButton = (actor: string) => <button className="dna-actor-link" onClick={() => onSelectActor(actor)}>{displayName(actor)}</button>;
  const heatmap = useMemo(() => {
    const actorLabels = metrics.actors.map(actor => displayName(actor.actor));
    const byPair = new Map(metrics.pairs.flatMap(pair => [[`${pair.a}|${pair.b}`, pair], [`${pair.b}|${pair.a}`, pair]]));
    const valueKey = projection === "congruence" ? "congruenceCosine" : "conflictCosine";
    const rawKey = projection === "congruence" ? "congruence" : "conflict";
    const color = projection === "congruence" ? ["#f4f0e6", "#d8e6dd", "#71a68e", "#265d4d"] : ["#f4f0e6", "#f2d7d1", "#da8b7c", "#963c31"];
    const data = metrics.actors.flatMap((actorY, y) => metrics.actors.map((actorX, x) => {
      if (actorX.actor === actorY.actor) return { value: [x, y, -1] };
      const pair = byPair.get(`${actorX.actor}|${actorY.actor}`)!;
      return { value: [x, y, pair[valueKey]], raw: pair[rawKey], shared: pair.shared.map(concept => CONCEPT_LABELS[concept]).join(" · ") || "Tidak ada" };
    }));
    return {
      animationDurationUpdate: 280,
      grid: { left: 175, right: 104, top: 22, bottom: 142 },
      xAxis: { type: "category", data: actorLabels, axisLabel: { interval: 0, rotate: 38, color: "#4f5967", fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: "#c9c4b9" } } },
      yAxis: { type: "category", data: actorLabels, inverse: true, axisLabel: { color: "#4f5967", fontSize: 11, width: 145, overflow: "truncate" }, axisTick: { show: false }, axisLine: { lineStyle: { color: "#c9c4b9" } } },
      visualMap: { min: 0, max: 1, calculable: false, orient: "vertical", right: 20, top: "middle", text: ["tinggi", "rendah"], textGap: 8, itemWidth: 14, itemHeight: 120, textStyle: { color: "#596270", fontSize: 11 }, inRange: { color } },
      tooltip: { confine: true, backgroundColor: "#10141d", borderWidth: 0, textStyle: { color: "#fffdf7", fontSize: 12 }, formatter: (params: { data: { value: [number, number, number]; raw?: number; shared?: string } }) => {
        const [x, y, value] = params.data.value;
        if (value < 0) return "Aktor yang sama";
        return `<b>${actorLabels[y]}</b><br/>${actorLabels[x]}<br/><br/>${projection === "congruence" ? "Congruence" : "Conflict"}: <b>${score(value)}</b><br/>Kecocokan mentah: ${params.data.raw}<br/>Konsep bersama: ${params.data.shared}`;
      } },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fffdf7", borderWidth: 2 }, emphasis: { itemStyle: { borderColor: "#10141d", borderWidth: 2 } }, label: { show: true, color: "#10141d", fontSize: 9, formatter: (params: { value: [number, number, number] }) => params.value[2] >= 0.5 ? score(params.value[2]) : "" } }],
    };
  }, [metrics, displayName, projection]);

  return <section className="dna-tables" aria-label="Perhitungan jaringan">
    <header className="dna-tables-heading"><div><h2>Perhitungan jaringan</h2><p>Aktor utama · mengikuti tahun, peristiwa, dan pencarian pada graph.</p></div>
      <div className="dna-summary"><span><b>{metrics.actors.length}</b> aktor aktif</span><span><b>{metrics.documents}</b> dokumen</span><span><b>{metrics.edges}</b> relasi aktor–konsep</span><span title="Relasi terisi ÷ (aktor aktif × 6 konsep)"><b>{score(metrics.density * 100)}%</b> kepadatan</span></div>
    </header>
    <div className="dna-table-toolbar"><div className="dna-table-tabs" aria-label="Jenis perhitungan">{tabs.map(item => <button key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === tabs[1] ? <div className="dna-projection-toggle" role="group" aria-label="Jenis proyeksi"><button aria-pressed={projection === "congruence"} onClick={() => setProjection("congruence")}>Congruence</button><button aria-pressed={projection === "conflict"} onClick={() => setProjection("conflict")}>Conflict</button></div> : <span className="dna-table-key"><i>+ Support</i><em>− Oppose</em></span>}
    </div>
    <div className="dna-table-scroll">
      {tab === tabs[0] && <table><caption>Dokumen unik per aktor, konsep, dan posisi.</caption><thead><tr><th scope="col">Aktor</th>{concepts.map(concept => <th scope="col" key={concept}>{CONCEPT_LABELS[concept]}</th>)}</tr></thead><tbody>{metrics.actors.map(actor => <tr key={actor.actor}><th scope="row">{actorButton(actor.actor)}<small>{actor.documents} dokumen · {actor.degree} konsep</small></th>{actor.cells.map(cell => <td key={cell.concept}>{cell.support || cell.oppose ? <div className="dna-cell"><span className={cell.support ? "dna-positive" : "dna-zero"}>+{cell.support}</span><span className={cell.oppose ? "dna-negative" : "dna-zero"}>−{cell.oppose}</span></div> : <span className="dna-zero">-</span>}</td>)}</tr>)}</tbody></table>}
      {tab === tabs[1] && <div className="dna-heatmap" ref={heatmapRef}><div className="dna-heatmap-head"><p>Hover sel untuk melihat dua aktor, skor, dan konsep yang membentuk perhitungan. Diagonal adalah aktor yang sama.</p><FigureActions targetRef={heatmapRef} name="Kongruensi aktor" /></div><ReactECharts option={heatmap} style={{ height: Math.max(440, metrics.actors.length * 35 + 170), width: "100%" }} opts={{ renderer: "svg" }} /></div>}
      {tab === tabs[2] && <table><caption>Degree menghitung konsep terhubung; bobot menjumlahkan dokumen unik pada setiap relasi bertanda.</caption><thead><tr><th scope="col">Aktor</th><th scope="col">Dokumen unik</th><th scope="col">Pernyataan unik</th><th scope="col">Degree / 6</th><th scope="col">Degree normal</th><th scope="col">Posisi terisi / 12</th><th scope="col">Bobot dokumen</th></tr></thead><tbody>{metrics.actors.map(actor => <tr key={actor.actor}><th scope="row">{actorButton(actor.actor)}</th><td>{actor.documents}</td><td>{actor.statements}</td><td>{actor.degree}</td><td>{score(actor.degree / concepts.length)}</td><td>{actor.positions}</td><td>{actor.weight}</td></tr>)}</tbody></table>}
      {!metrics.actors.length && <p className="dna-empty">Belum ada pernyataan aktor utama pada filter ini.</p>}
      {tab === tabs[1] && metrics.actors.length === 1 && <p className="dna-empty">Diperlukan dua aktor untuk menghitung pasangan.</p>}
    </div>
    <details className="dna-method"><summary>Cara menghitung dan cakupan</summary>
      <p>Input: pernyataan support/oppose terkode dari aktor utama yang sama dengan graph, termasuk hasil coding otomatis. Posisi dokumen media sosial tidak ditambahkan sebagai posisi aktor. Filter posisi dokumen dan pemilihan node tidak mengubah tabel ini.</p>
      <p>Untuk setiap konsep c, Pᵢc = 1 jika aktor i memiliki support; Nᵢc = 1 jika memiliki oppose. Congruence Gᵢⱼ = Σc(PᵢcPⱼc + NᵢcNⱼc); conflict Fᵢⱼ = Σc(PᵢcNⱼc + NᵢcPⱼc). Keduanya dibagi √(dᵢdⱼ), dengan dᵢ = Σc(Pᵢc + Nᵢc). Ini varian proyeksi biner dengan normalisasi cosine.</p>
      <p>Pengulangan kutipan tidak menaikkan skor biner. Dua posisi pada konsep yang sama tetap disimpan, sehingga satu pasangan dapat memiliki congruence sekaligus conflict. Skor 1 dari satu konsep bersama memiliki cakupan bukti lebih sempit daripada beberapa konsep.</p>
      <p>Kepadatan = relasi aktor–konsep terisi / (aktor aktif × 6). Bobot dokumen dapat melebihi dokumen unik karena satu dokumen memuat beberapa konsep atau posisi. Aktor tanpa pernyataan pada filter dikeluarkan dari perhitungan; perubahan cakupan memengaruhi perbandingan waktu. Posisi yang belum terkode bukan oppose.</p>
      <p>Skor menggambarkan kesamaan dan pertentangan posisi terkode, bukan bukti langsung koalisi atau hegemoni. Rujukan: <a href="https://github.com/leifeld-lab/dna" target="_blank" rel="noreferrer">Discourse Network Analyzer</a>.</p>
    </details>
  </section>;
}
