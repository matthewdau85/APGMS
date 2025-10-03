import os
import uvicorn

MODULE = os.getenv("APP_MODULE", "app.main:app")
HOST = os.getenv("UVICORN_HOST", "0.0.0.0")
PORT = int(os.getenv("UVICORN_PORT", "8001"))
RELOAD = os.getenv("UVICORN_RELOAD", "0") == "1"

if __name__ == "__main__":
    uvicorn.run(MODULE, host=HOST, port=PORT, reload=RELOAD)
