"""Shared port interfaces for both Python and TypeScript services."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, MutableMapping, Protocol, TypedDict


class RPT(TypedDict, total=False):
    rpt_id: str
    kid: str
    payload_sha256: str
    # Additional fields allowed


class PayoutReference(TypedDict, total=False):
    abn: str
    taxType: str
    periodId: str
    ledgerId: str


class PayoutResult(TypedDict, total=False):
    transferUuid: str
    bankReceiptHash: str
    providerReceiptId: str
    rawResponse: Any


class StatementRecord(TypedDict, total=False):
    statementId: str
    amount_cents: int
    reference: str
    issued_at: str
    metadata: MutableMapping[str, Any]


class IngestResult(TypedDict, total=False):
    recordsIngested: int
    discarded: int
    batchId: str
    metadata: MutableMapping[str, Any]


class BankEgressPort(Protocol):
    async def payout(self, rpt: RPT, amount_cents: int, ref: PayoutReference) -> PayoutResult: ...


class BankStatementsPort(Protocol):
    async def ingest(self, csv: str | bytes) -> IngestResult: ...

    async def listUnreconciled(self) -> list[StatementRecord]: ...


CompactJWS = str


class JwksResult(TypedDict, total=False):
    keys: list[Mapping[str, Any]]


class KmsPort(Protocol):
    async def signJWS(self, payload: Mapping[str, Any] | str | bytes) -> CompactJWS: ...

    async def rotate(self) -> None: ...

    async def jwks(self) -> JwksResult: ...

    async def verify(self, payload: bytes | str, signature: bytes | str) -> bool: ...


class RatesVersion(TypedDict, total=False):
    effectiveDate: str
    updatedAt: str
    rates: MutableMapping[str, float]


class RatesPort(Protocol):
    async def currentFor(self, date: str | Any) -> RatesVersion: ...

    async def listVersions(self) -> list[RatesVersion]: ...


IdentityCredentials = Mapping[str, Any]


class Identity(TypedDict, total=False):
    id: str
    claims: MutableMapping[str, Any]


class IdentityPort(Protocol):
    async def authenticate(self, credentials: IdentityCredentials) -> Identity | None: ...

    async def authorize(self, identity: Identity, resource: str, action: str) -> bool: ...


AnomalyDecision = str


class AnomalyScore(TypedDict, total=False):
    decision: AnomalyDecision
    score: float
    metadata: MutableMapping[str, Any]


class AnomalyPort(Protocol):
    async def score(self, payload: Mapping[str, Any]) -> AnomalyScore: ...


@dataclass(slots=True)
class ProviderDescriptor:
    port: str
    variant: str
