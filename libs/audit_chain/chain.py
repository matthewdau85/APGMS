# libs/audit_chain/chain.py
import hashlib
from typing import Optional

def link(prev_hash: Optional[str], payload: str) -> str:
    h = hashlib.sha256()
    if prev_hash:
        h.update(prev_hash.encode("utf-8"))
    h.update(payload.encode("utf-8"))
    return h.hexdigest()
