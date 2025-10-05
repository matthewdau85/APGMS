"""Operational pipelines for APGMS content ingestion and configuration management.

This module defines three orchestrations derived from the developer pipelines brief:

1. IngestPipeline - performs document ingestion with chunking, classification,
   deduplication, staging, validation, and publish evaluation hooks.
2. ConfigAdapter - handles configuration updates/adaptations, including
   version tagging, live-version promotion, and summary generation.
3. RollbackManager - restores a prior configuration tag and resets downstream
   aliases (e.g. the production search index alias).

The implementations favour clarity and traceability over complex ML/ETL stacks.
Each step emits structured results so callers can store audit trails or plug in
system-specific integrations.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple
import csv
import io
import json
import re


# ---------------------------------------------------------------------------
# Shared data structures
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class Document:
    """Represents an ingestible document."""

    path: Path
    raw_bytes: bytes
    collection: str

    @property
    def name(self) -> str:
        return self.path.name

    @property
    def suffix(self) -> str:
        return self.path.suffix.lower()


@dataclass(slots=True)
class Chunk:
    """Represents a text chunk produced by the chunking stage."""

    text: str
    index: int
    source_document: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def length(self) -> int:
        return len(self.text)


@dataclass(slots=True)
class PipelineWarning:
    """Structured warning emitted during pipeline execution."""

    message: str
    stage: str
    context: Dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class IngestResult:
    """Full output of an ingest run."""

    document: Document
    chunks: List[Chunk]
    classifications: Dict[str, Any]
    staged_payload: Dict[str, Any]
    warnings: List[PipelineWarning]


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


_TABLE_LINE = re.compile(r"^(?:\s*[\d,\.]+\s*(?:\t|\s{2,}))+[\d,\.]+\s*$")
_CONFIG_LIKE_SUFFIXES = {".json", ".csv", ".yml", ".yaml"}
_SCHEMA_GUARDS: Dict[str, Callable[[Any], Tuple[bool, str]]] = {
    "PAYG": lambda payload: _schema_min_keys(payload, {"version", "rates"}),
    "GST_BAS": lambda payload: _schema_min_keys(payload, {"version", "labels"}),
    "PENALTIES_INTEREST": lambda payload: _schema_min_keys(payload, {"version", "penalties"}),
}


def _schema_min_keys(payload: Any, required: set[str]) -> Tuple[bool, str]:
    if isinstance(payload, dict):
        missing = sorted(required.difference(payload))
        if missing:
            return False, f"missing keys: {', '.join(missing)}"
        return True, "ok"
    if isinstance(payload, list) and payload:
        if isinstance(payload[0], dict):
            missing = sorted(required.difference(payload[0]))
            if missing:
                return False, f"missing keys: {', '.join(missing)}"
            return True, "ok"
    return False, "expected object with keys"


# ---------------------------------------------------------------------------
# Ingest pipeline
# ---------------------------------------------------------------------------


class IngestPipeline:
    """Co-ordinates the ingestion workflow described in the developer brief."""

    def __init__(
        self,
        *,
        target_tokens: int = 1200,
        overlap: int = 200,
        min_chunks_threshold: int = 1,
        evaluator: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.target_tokens = max(target_tokens, 1)
        self.overlap = max(min(overlap, self.target_tokens - 1), 0)
        self.min_chunks_threshold = max(min_chunks_threshold, 1)
        self._evaluator = evaluator or self._default_eval

    # -- public API -----------------------------------------------------

    def run(self, document: Document) -> IngestResult:
        detected = self._detect_format(document)
        parsed = self._parse(document, detected)
        cleaned = self._clean(parsed)
        chunks = self._chunk(cleaned, document)
        deduped = self._dedupe(chunks)
        classifications = self._classify(deduped, document)
        staged_payload = self._stage(document, deduped, classifications)
        warnings = self._validate(document, deduped)
        self._publish(document, staged_payload)
        return IngestResult(
            document=document,
            chunks=deduped,
            classifications=classifications,
            staged_payload=staged_payload,
            warnings=warnings,
        )

    # -- pipeline stages ------------------------------------------------

    def _detect_format(self, document: Document) -> str:
        suffix = document.suffix
        if suffix in {".csv", ".tsv", ".xlsx", ".xls"}:
            return "spreadsheet"
        if suffix in {".json"}:
            return "json"
        if suffix in {".pdf"}:
            return "pdf"
        if suffix in {".md", ".markdown"}:
            return "markdown"
        if suffix in {".txt"}:
            return "text"
        return "binary"

    def _parse(self, document: Document, detected: str) -> str:
        data = document.raw_bytes
        if detected == "spreadsheet":
            return self._parse_spreadsheet(document)
        if detected == "json":
            try:
                parsed = json.loads(data.decode("utf-8"))
                return json.dumps(parsed, indent=2, ensure_ascii=False)
            except Exception:
                return data.decode("utf-8", errors="ignore")
        if detected == "pdf":
            # Placeholder OCR hook; real implementation would call OCR engine.
            return self._perform_ocr(data)
        return data.decode("utf-8", errors="ignore")

    def _perform_ocr(self, data: bytes) -> str:
        return "[OCR extraction unavailable in this environment]"

    def _parse_spreadsheet(self, document: Document) -> str:
        suffix = document.suffix
        if suffix in {".csv", ".tsv"}:
            dialect = csv.excel_tab if suffix == ".tsv" else csv.excel
            text_stream = io.StringIO(document.raw_bytes.decode("utf-8", errors="ignore"))
            reader = csv.reader(text_stream, dialect)
            rows = [",".join(row) for row in reader]
            sheet_name = document.path.stem or "Sheet1"
            return "\n".join([f"SHEET: {sheet_name}", *rows])
        # For binary spreadsheet formats we do not have an engine available.
        return "[SHEET: Sheet1]\n" + "\n".join([
            "csv_not_supported_without_excel_backend"
        ])

    def _clean(self, text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        lines = [line.rstrip() for line in text.split("\n")]
        # Collapse duplicated blank lines while preserving table spacing.
        cleaned_lines: List[str] = []
        blank_streak = 0
        for line in lines:
            if not line.strip():
                blank_streak += 1
                if blank_streak <= 1:
                    cleaned_lines.append("")
                continue
            blank_streak = 0
            cleaned_lines.append(line)
        return "\n".join(cleaned_lines).strip()

    def _chunk(self, text: str, document: Document) -> List[Chunk]:
        if not text:
            return []
        paragraphs = self._split_paragraphs(text)
        target = self.target_tokens
        overlap = self.overlap
        chunks: List[Chunk] = []
        current: List[str] = []
        current_token_count = 0
        heading_buffer: Optional[str] = None

        def flush(idx: int) -> None:
            nonlocal current, current_token_count, heading_buffer
            if not current:
                return
            chunk_text = "\n".join(current).strip()
            if heading_buffer is not None:
                chunk_text = f"{heading_buffer}\n{chunk_text}" if chunk_text else heading_buffer
                heading_buffer = None
            chunk = Chunk(text=chunk_text, index=idx, source_document=document.name)
            chunks.append(chunk)
            if overlap and chunks:
                tail_tokens = chunk_text.split()
                if tail_tokens:
                    retained_tokens = tail_tokens[-min(overlap, len(tail_tokens)) :]
                    retained_text = " ".join(retained_tokens)
                    current = [retained_text] if retained_text else []
                    current_token_count = len(retained_tokens)
                    return
            current = []
            current_token_count = 0

        idx = 0
        for paragraph in paragraphs:
            tokens = paragraph.split()
            token_count = len(tokens)
            if _is_heading(paragraph):
                # Keep headings at the beginning of the next chunk.
                heading_buffer = paragraph
                continue
            if current_token_count + token_count > target and current:
                flush(idx)
                idx += 1
            current.append(paragraph)
            current_token_count += token_count
        flush(idx)
        if heading_buffer is not None:
            idx += 1
            chunks.append(Chunk(text=heading_buffer, index=idx, source_document=document.name))
        return chunks

    def _split_paragraphs(self, text: str) -> List[str]:
        out: List[str] = []
        for block in text.split("\n\n"):
            lines = block.split("\n")
            if any(_TABLE_LINE.match(line) for line in lines):
                out.append("\n".join(lines))
            else:
                out.append(" ".join(line.strip() for line in lines if line.strip()))
        return [p for p in out if p]

    def _classify(self, chunks: Sequence[Chunk], document: Document) -> Dict[str, Any]:
        labels: Dict[str, float] = {}
        for position, chunk in enumerate(chunks):
            score = _score_chunk(chunk.text, document.collection)
            chunk.index = position
            chunk.metadata["classification_score"] = score
            labels[position] = score
        return {
            "collection": document.collection,
            "scores": labels,
        }

    def _dedupe(self, chunks: Sequence[Chunk]) -> List[Chunk]:
        seen: set[str] = set()
        deduped: List[Chunk] = []
        for chunk in chunks:
            fingerprint = chunk.text.strip()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            copy = Chunk(
                text=chunk.text,
                index=len(deduped),
                source_document=chunk.source_document,
                metadata=dict(chunk.metadata),
            )
            deduped.append(copy)
        return deduped

    def _stage(
        self,
        document: Document,
        chunks: Sequence[Chunk],
        classifications: Dict[str, Any],
    ) -> Dict[str, Any]:
        return {
            "document": document.name,
            "collection": document.collection,
            "chunk_count": len(chunks),
            "chunks": [
                {
                    "index": chunk.index,
                    "text": chunk.text,
                    "metadata": chunk.metadata,
                }
                for chunk in chunks
            ],
            "classifications": classifications,
        }

    def _validate(
        self,
        document: Document,
        chunks: Sequence[Chunk],
    ) -> List[PipelineWarning]:
        warnings: List[PipelineWarning] = []
        above_threshold = sum(1 for chunk in chunks if chunk.length > 300)
        if above_threshold < self.min_chunks_threshold:
            warnings.append(
                PipelineWarning(
                    message=(
                        "document produced insufficient dense chunks; "
                        f"expected >= {self.min_chunks_threshold} over 300 chars, got {above_threshold}"
                    ),
                    stage="validate",
                    context={"document": document.name, "chunk_count": len(chunks)},
                )
            )

        if (
            document.collection in _SCHEMA_GUARDS
            and document.suffix in _CONFIG_LIKE_SUFFIXES
        ):
            guard = _SCHEMA_GUARDS[document.collection]
            try:
                validator_payload = self._load_for_validation(document)
            except Exception as exc:  # pragma: no cover - defensive
                warnings.append(
                    PipelineWarning(
                        message=f"failed to load config for schema validation: {exc}",
                        stage="validate",
                        context={"collection": document.collection, "document": document.name},
                    )
                )
            else:
                ok, reason = guard(validator_payload)
                if not ok:
                    warnings.append(
                        PipelineWarning(
                            message=f"schema validation failed: {reason}",
                            stage="validate",
                            context={"collection": document.collection, "document": document.name},
                        )
                    )
        return warnings

    def _load_for_validation(self, document: Document) -> Any:
        suffix = document.suffix
        data = document.raw_bytes.decode("utf-8", errors="ignore")
        if suffix == ".json":
            return json.loads(data)
        if suffix in {".csv", ".tsv"}:
            reader = csv.DictReader(io.StringIO(data))
            return list(reader)
        if suffix in {".yml", ".yaml"}:
            try:
                import yaml  # type: ignore

                return yaml.safe_load(data)
            except Exception:
                return {}
        return {}

    def _publish(self, document: Document, payload: Dict[str, Any]) -> None:
        # Hook into the evaluation suite as part of the publish step.
        self._evaluator("tax-regression")

    # -- internal helpers ----------------------------------------------

    @staticmethod
    def _default_eval(suite: str) -> None:
        # Placeholder for the real evaluation harness.
        print(f"[eval] test_suite('{suite}') invoked")


def _is_heading(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    return bool(re.match(r"^[A-Z0-9][A-Z0-9\s:/-]{2,}$", stripped))


def _score_chunk(text: str, collection: str) -> float:
    tokens = text.lower().split()
    hits = sum(1 for token in tokens if token in {"payg", "gst", "bas", "penalty", "interest"})
    base = 1 + len(text) / 1000
    return min(1.0, (hits / max(len(tokens), 1)) * base)


# ---------------------------------------------------------------------------
# Configuration update/adaptation pipeline
# ---------------------------------------------------------------------------


@dataclass
class ConfigRecord:
    tag: str
    payload: Dict[str, Any]
    summary: str
    effective_date: Optional[str] = None
    impacted_features: List[str] = field(default_factory=list)


class ConfigAdapter:
    """Handles configuration updates and adaptation workflows."""

    def __init__(self) -> None:
        self._versions: Dict[str, ConfigRecord] = {}
        self.live_version: Optional[str] = None

    def apply(
        self,
        *,
        tag: str,
        config: Dict[str, Any],
        previous: Optional[Dict[str, Any]] = None,
        effective_date: Optional[str] = None,
        impacted_features: Optional[Iterable[str]] = None,
    ) -> ConfigRecord:
        changes = _diff_keys(previous or {}, config)
        summary = self._build_summary(changes, effective_date, impacted_features)
        record = ConfigRecord(
            tag=tag,
            payload=config,
            summary=summary,
            effective_date=effective_date,
            impacted_features=list(impacted_features or []),
        )
        self._versions[tag] = record
        self.live_version = tag
        return record

    def _build_summary(
        self,
        changes: Dict[str, Tuple[Any, Any]],
        effective_date: Optional[str],
        impacted_features: Optional[Iterable[str]],
    ) -> str:
        lines = ["Configuration update summary:"]
        if changes:
            lines.append("Changed keys:")
            for key, (old, new) in sorted(changes.items()):
                lines.append(f" - {key}: {old!r} -> {new!r}")
        else:
            lines.append("No key changes detected.")
        if effective_date:
            lines.append(f"New effective date: {effective_date}")
        if impacted_features:
            lines.append("Impacted features:")
            for feature in impacted_features:
                lines.append(f" - {feature}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Rollback pipeline
# ---------------------------------------------------------------------------


@dataclass
class RollbackState:
    restored_tag: str
    live_version: Optional[str]
    search_alias_target: str


class RollbackManager:
    """Restores prior configuration tags and associated search aliases."""

    def __init__(self, adapter: ConfigAdapter) -> None:
        self._adapter = adapter
        self.search_alias: str = "prod"

    def rollback(self, previous_tag: str) -> RollbackState:
        if previous_tag not in self._adapter._versions:
            raise KeyError(f"Unknown config tag: {previous_tag}")
        self._adapter.live_version = previous_tag
        self.search_alias = f"index@{previous_tag}"
        return RollbackState(
            restored_tag=previous_tag,
            live_version=self._adapter.live_version,
            search_alias_target=self.search_alias,
        )


# ---------------------------------------------------------------------------
# Diff helper
# ---------------------------------------------------------------------------


def _diff_keys(old: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, Tuple[Any, Any]]:
    diff: Dict[str, Tuple[Any, Any]] = {}
    keys = set(old) | set(new)
    for key in keys:
        if old.get(key) != new.get(key):
            diff[key] = (old.get(key), new.get(key))
    return diff


__all__ = [
    "Document",
    "Chunk",
    "IngestPipeline",
    "IngestResult",
    "PipelineWarning",
    "ConfigAdapter",
    "RollbackManager",
    "ConfigRecord",
    "RollbackState",
]
