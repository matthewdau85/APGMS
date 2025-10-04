import os
import uvicorn

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8001"))
RELOAD = os.getenv("RELOAD", "false").lower() in {"1", "true", "yes"}
MODULE = "app.main:app"

if __name__ == "__main__":
    uvicorn.run(MODULE, host=HOST, port=PORT, reload=RELOAD)