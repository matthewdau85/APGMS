"""Encrypted storage for ML artifacts."""
from __future__ import annotations

import json
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet, InvalidToken

from .security import get_cipher


class StoreCorruptionError(RuntimeError):
    """Raised when the encrypted ML store cannot be decrypted."""


class EncryptedMLStore:
    """Persist ML artifacts in an encrypted file."""

    def __init__(self, path: Path, cipher: Optional[Fernet] = None) -> None:
        self._path = path
        self._cipher = cipher or get_cipher()
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _read_encrypted(self) -> Optional[bytes]:
        if not self._path.exists():
            return None
        return self._path.read_bytes()

    def _decrypt_payload(self, payload: bytes) -> List[Dict[str, Any]]:
        if not payload:
            return []
        try:
            decrypted = self._cipher.decrypt(payload)
        except InvalidToken as exc:
            raise StoreCorruptionError("Unable to decrypt ML artifact store") from exc
        if not decrypted:
            return []
        return json.loads(decrypted.decode("utf-8"))

    def _encrypt(self, records: List[Dict[str, Any]]) -> bytes:
        serialized = json.dumps(records, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return self._cipher.encrypt(serialized)

    def _write_atomic(self, payload: bytes) -> None:
        tmp_path = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp_path.write_bytes(payload)
        tmp_path.replace(self._path)

    def _load(self) -> List[Dict[str, Any]]:
        raw = self._read_encrypted()
        if raw is None:
            return []
        return self._decrypt_payload(raw)

    def append_or_replace(self, record: Dict[str, Any]) -> None:
        """Insert or replace an artifact by document id."""
        with self._lock:
            records = self._load()
            for idx, existing in enumerate(records):
                if existing.get("document_id") == record.get("document_id"):
                    records[idx] = record
                    break
            else:
                records.append(record)
            self._write_atomic(self._encrypt(records))

    def list_all(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(item) for item in self._load()]

    def get(self, document_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for record in self._load():
                if record.get("document_id") == document_id:
                    return dict(record)
        return None

    def delete(self, document_id: str) -> None:
        with self._lock:
            records = [r for r in self._load() if r.get("document_id") != document_id]
            self._write_atomic(self._encrypt(records))


@lru_cache(maxsize=1)
def get_store() -> EncryptedMLStore:
    """Return the configured store instance (cached)."""
    path_env = os.getenv("ML_STORE_PATH")
    if path_env:
        path = Path(path_env)
    else:
        path = Path("/tmp/ml_assist_store.enc")
    return EncryptedMLStore(path)
