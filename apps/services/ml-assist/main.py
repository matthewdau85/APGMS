"""Entrypoint for running the ML Assist FastAPI app."""

from __future__ import annotations

import uvicorn

from ml_assist.service import create_app


app = create_app()


if __name__ == "__main__":
    uvicorn.run("ml_assist.service:create_app", factory=True, host="0.0.0.0", port=8000, reload=False)
