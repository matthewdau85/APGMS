FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY provider_bindings.json ./provider_bindings.json
COPY capability_state.json ./capability_state.json
EXPOSE 8000
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000"]