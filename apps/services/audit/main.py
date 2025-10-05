from fastapi import FastAPI, APIRouter
from pydantic import BaseModel
from typing import List
import asyncpg
import os

app = FastAPI(title="audit")
router = APIRouter()


class AuditRow(BaseModel):
    id: int
    abn: str
    period_id: int
    event: str
    payload: dict
    hash: str
    prev_hash: str
    created_at: str


@router.get("/audit/bundle/{period_id}", response_model=List[AuditRow])
async def audit_bundle(period_id: int, abn: str):
    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    try:
        rows = await conn.fetch(
            """
          select id, abn, period_id, event, payload, hash, prev_hash,
                 to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
            from audit_events
           where abn=$1 and period_id=$2
           order by id asc
        """,
            abn,
            period_id,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


app.include_router(router)
