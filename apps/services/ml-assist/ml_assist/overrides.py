"""Persistence for human overrides of advisory outputs."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


class OverrideStore:
    """Simple JSON-backed store capturing operator overrides."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        if not self._path.parent.exists():
            self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._path.write_text("{}\n", encoding="utf-8")

    def record(self, channel: str, entity_id: str, override: Any) -> None:
        """Persist an override decision for a given entity."""
        timestamp = datetime.now(timezone.utc).isoformat()
        payload = {"override": override, "recorded_at": timestamp}
        with self._lock:
            data = self._load()
            channel_bucket = data.setdefault(channel, {})
            history = channel_bucket.setdefault(entity_id, [])
            history.append(payload)
            self._dump(data)

    def _load(self) -> Dict[str, Any]:
        raw = self._path.read_text(encoding="utf-8")
        return json.loads(raw) if raw.strip() else {}

    def _dump(self, data: Dict[str, Any]) -> None:
        self._path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
