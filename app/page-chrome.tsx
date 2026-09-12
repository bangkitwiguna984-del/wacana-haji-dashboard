import type { TabId } from "./dashboard-model";

export const PAGE_META: Record<TabId, { number: string; label: string }> = {
  corpus: { number: "01", label: "Orientasi korpus" },
  network: { number: "02", label: "Struktur relasional" },
  compare: { number: "03", label: "Perubahan konfigurasi" },
  evidence: { number: "04", label: "Audit bukti" },
};

export function PageLead({ tab, title, children }: { tab: TabId; title: string; children: React.ReactNode }) {
  return (
    <header className="page-lead">
      <span className="folio" aria-hidden="true">{PAGE_META[tab].number}</span>
      <div className="lead-copy">
        <p className="kicker">{PAGE_META[tab].number} / {PAGE_META[tab].label}</p>
        <h1>{title}</h1><p>{children}</p>
      </div>
    </header>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state"><span>∅</span><strong>Tidak ada data pada filter ini</strong><p>{children}</p></div>;
}
