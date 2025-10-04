"""
Example FastAPI readiness:
- /readyz returns 200 only after NATS connects.
- /metrics exposes prometheus_client metrics.
"""
import asyncio
import os
from fastapi import FastAPI
from prometheus_client import REGISTRY, generate_latest, CONTENT_TYPE_LATEST
from fastapi.responses import Response
import nats

app = FastAPI()
_ready = asyncio.Event()

@app.on_event("startup")
async def startup():
    url = os.getenv("NATS_URL", "nats://nats:4222")
    app.state.nc = await nats.connect(url, reconnect=True, max_reconnect_attempts=-1)
    # TODO: add subscriptions/JetStream setup here
    _ready.set()

@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "nc"):
        await app.state.nc.drain()

@app.get("/readyz")
async def readyz():
    return {"status": "ok"} if _ready.is_set() else Response(status_code=503)

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)