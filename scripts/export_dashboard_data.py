"""Create browser-ready data extracts from the reproducible research outputs."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd


PROJECT_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = PROJECT_DIR / "dashboard" / "public" / "data"


# These are the same lexical candidate rules recorded in statements_v1/codebook.csv.
# They indicate potentially relevant documents; they do not assign a discourse stance.
CONCEPT_INDICATORS = {
    "ponzi": r"\bponzi\b",
    "subsidi_silang": r"\bsubsidi\w*\b|\bnilai\s+manfaat\b",
    "kenaikan_biaya": r"\b(?:naik|kenaikan|menaikkan|dinaikkan)\b.{0,60}\b(?:biaya|ongkos|bpih|bipih)\b|\b(?:biaya|ongkos|bpih|bipih)\b.{0,60}\b(?:naik|kenaikan|menaikkan|dinaikkan)\b",
    "keamanan_dana": r"\b(?:aman|keamanan|amanah|transparan|transparansi|percaya|kepercayaan)\b",
    "keadilan": r"\b(?:adil|keadilan|ketidakadilan|hak|merugikan|dirugikan)\b",
    "keberlanjutan": r"\b(?:berkelanjutan|keberlanjutan|sustainability|berkesinambungan)\b|gali lubang",
}

ACTOR_ALIASES = {
    "maaruf amin": "Ma'ruf Amin",
    "ma'ruf amin": "Ma'ruf Amin",
    "asrorun ni'am sholeh": "Asrorun Niam Sholeh",
    "gus yaqut": "Yaqut Cholil Qoumas",
    "zaky zakaria anshary": "Zaki Zakaria Anshary",
}


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


def export_corpus() -> pd.DataFrame:
    corpus = read_csv("data/derived/case_selection_v2/corpus_2021_2024.csv")
    searchable_text = corpus["document_text"].fillna("").astype(str)
    for concept, pattern in CONCEPT_INDICATORS.items():
        corpus[concept] = searchable_text.str.contains(re.compile(pattern, re.IGNORECASE), na=False)
    columns = [
        "document_id", "published_at", "year", "month", "channel", "platform",
        "content_type", "title", "url", "event_id", "event_name", "query_sources",
        *CONCEPT_INDICATORS.keys(),
    ]
    write_json(corpus[columns], "corpus.json")
    provenance = pd.read_csv(
        PROJECT_DIR / "data/derived/corpus_v1/records.csv",
        usecols=["record_id", "source_id", "source_file", "source_sheet", "source_row"],
    ).rename(columns={"record_id": "representative_record_id"})
    documents = corpus.merge(provenance, on="representative_record_id", how="left", validate="one_to_one")
    documents["source_locator"] = documents.apply(
        lambda row: f"{row['source_file']}::{row['source_sheet']}::{int(row['source_row']) if pd.notna(row['source_row']) else ''}",
        axis=1,
    )
    document_columns = [
        "document_id", "published_at", "year", "month", "channel", "platform", "content_type",
        "author", "mentioned_actors_raw", "title", "document_text", "url", "sentiment", "event_id",
        "event_name", "query_sources", "source_id", "source_file", "source_sheet", "source_row",
        "source_locator", *CONCEPT_INDICATORS.keys(),
    ]
    write_json(documents[document_columns], "documents.json")
    return corpus[columns].copy()


def normalize_actor(value: object) -> str:
    actor = re.sub(r"\s+", " ", str(value)).strip()
    return ACTOR_ALIASES.get(actor.casefold(), actor)


def export_media_actor_mentions(corpus: pd.DataFrame) -> None:
    """Export media actor metadata without assigning an unsupported stance."""
    source = pd.read_excel(
        PROJECT_DIR / "Laporan BPKH Ponzi Haji 2021 - 2023.xlsx",
        sheet_name="Streaming",
        header=3,
    )
    media_documents = corpus[corpus["channel"].eq("media_massa")].copy()
    media_documents["url_key"] = media_documents["url"].fillna("").str.strip().str.rstrip("/").str.casefold()
    source["url_key"] = source["Url"].fillna("").str.strip().str.rstrip("/").str.casefold()
    source["source_row"] = source.index + 5
    joined = source.merge(media_documents, on="url_key", how="inner", validate="many_to_one")

    rows = []
    for row in joined.itertuples(index=False):
        actors = {
            normalize_actor(actor)
            for actor in re.split(r"[,;|]", str(row.Influencers or ""))
            if normalize_actor(actor) not in {"", "-", "nan"}
        }
        concepts = [concept for concept in CONCEPT_INDICATORS if bool(getattr(row, concept))]
        for actor in actors:
            rows.append({
                "document_id": row.document_id,
                "published_at": row.published_at,
                "year": row.year,
                "event_id": row.event_id,
                "event_name": row.event_name,
                "actor": actor,
                "concepts": concepts,
                "url": row.url,
                "source_locator": f"Laporan BPKH Ponzi Haji 2021 - 2023.xlsx::Streaming::{row.source_row}::Influencers",
            })
    mentions = pd.DataFrame(rows).drop_duplicates(["document_id", "actor"])
    write_json(mentions, "media_actor_mentions.json")


def export_dna() -> None:
    document_edges = read_csv("data/derived/dna_v1/document_edges.csv")
    statement_path = next(
        path for path in (
            "data/derived/statements_v3/dna_edges.csv",
            "data/derived/statements_v2/dna_edges.csv",
            "data/derived/statements_v1/dna_edges.csv",
        )
        if (PROJECT_DIR / path).exists()
    )
    statements = read_csv(statement_path)
    edge_columns = [
        "statement_id", "document_id", "published_at", "year", "channel", "platform",
        "event_id", "event_name", "actor", "actor_normalized", "concept", "proposition",
        "stance", "sign", "statement_text", "context_text", "position_evidence", "url",
        "source_locator", "stance_score", "score_margin", "actor_confidence",
        "actor_method", "validation_status",
    ]
    statement_columns = [column for column in edge_columns if column != "actor_normalized"]
    statement_columns += [column for column in ["subconcept", "subconcept_label"] if column in statements]
    write_json(document_edges[edge_columns], "document_edges.json")
    write_json(statements[statement_columns], "statements.json")
    write_json(read_csv("data/derived/case_selection_v2/event_windows.csv"), "event_windows.json")
    write_json(read_csv("data/derived/statements_v1/codebook.csv"), "codebook.json")


if __name__ == "__main__":
    corpus = export_corpus()
    export_media_actor_mentions(corpus)
    export_dna()
    print(f"Data dashboard ditulis ke: {OUTPUT_DIR}")
