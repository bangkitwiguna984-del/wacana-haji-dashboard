"use client";

import { useEffect, useState } from "react";
import Dashboard from "./dashboard";
import type { Dataset } from "./dashboard-model";

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  const response = await fetch(path);
  return response.ok ? ((await response.json()) as T) : fallback;
}

export default function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Only the tables the first screen needs. The Jaringan tab loads its own
    // document-level data separately so first paint does not wait on ~11 MB.
    Promise.all([
      loadJson("/data/corpus.json", []),
      loadJson("/data/document_edges.json", []),
      loadJson("/data/statements.json", []),
      loadJson("/data/event_windows.json", []),
    ])
      .then(([corpus, documentEdges, statements, events]) => {
        setDataset({ corpus, documentEdges, statements, events });
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <main className="loading-screen">
        <div className="loading-index">DNA / 21—24</div>
        <div>
          <p className="kicker">Dashboard riset</p>
          <h1>Data gagal dimuat</h1>
          <p>Periksa berkas pada public/data, lalu muat ulang halaman.</p>
        </div>
      </main>
    );
  }

  if (!dataset) {
    return (
      <main className="loading-screen">
        <div className="loading-index">DNA / 21—24</div>
        <div>
          <p className="kicker">Dashboard riset</p>
          <h1>Memuat data</h1>
          <p>Korpus, relasi aktor–konsep, dan pernyataan terkode 2021–2024.</p>
        </div>
      </main>
    );
  }

  return <Dashboard dataset={dataset} />;
}
