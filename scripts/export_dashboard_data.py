"""Create browser-ready data extracts from the reproducible research outputs."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


PROJECT_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = PROJECT_DIR / "dashboard" / "public" / "data"


def read_csv(relative_path: str) -> pd.DataFrame:
    return pd.read_csv(PROJECT_DIR / relative_path)


def write_json(frame: pd.DataFrame, filename: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    frame = frame.where(pd.notna(frame), None)
    records = json.loads(frame.to_json(orient="records", date_format="iso"))
    (OUTPUT_DIR / filename).write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def export_corpus() -> None:
    corpus = read_csv("data/derived/case_selection_v2/corpus_2021_2024.csv")
    columns = [
        "document_id", "published_at", "year", "month", "channel", "platform",
        "content_type", "title", "url", "event_id", "event_name", "query_sources",
        "ponzi", "subsidi", "biaya_haji", "dana_haji", "nilai_manfaat", "antrean_haji",
    ]
    write_json(corpus[columns], "corpus.json")


def export_dna() -> None:
    document_edges = read_csv("data/derived/dna_v1/document_edges.csv")
    statements = read_csv("data/derived/statements_v1/dna_edges.csv")
    edge_columns = [
        "statement_id", "document_id", "published_at", "year", "channel", "platform",
        "event_id", "event_name", "actor", "actor_normalized", "concept", "proposition",
        "stance", "sign", "statement_text", "context_text", "position_evidence", "url",
        "source_locator", "stance_score", "score_margin", "actor_confidence",
        "actor_method", "validation_status",
    ]
    statement_columns = [column for column in edge_columns if column != "actor_normalized"]
    write_json(document_edges[edge_columns], "document_edges.json")
    write_json(statements[statement_columns], "statements.json")
    write_json(read_csv("data/derived/case_selection_v2/event_windows.csv"), "event_windows.json")
    write_json(read_csv("data/derived/statements_v1/codebook.csv"), "codebook.json")


if __name__ == "__main__":
    export_corpus()
    export_dna()
    print(f"Data dashboard ditulis ke: {OUTPUT_DIR}")
