FROM python:3.11-slim

# Minimal system deps; add build tools only if you compile wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy app code (adjust paths only if your layout changes)
COPY apps/services/event-normalizer/app ./app
COPY apps/services/event-normalizer/run_normalizer.py /app/run_normalizer.py
COPY libs/json ./libs/schemas/json

# Install python deps (pinned)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Security: run as non-root
RUN useradd -m appuser
USER appuser

EXPOSE 8001
# Ensure app.main:app exists in your repo
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]