FROM python:3.11-slim
WORKDIR /app

# Install system dependencies for PostGIS/psycopg2
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["sh", "-c", "exec gunicorn -w ${WORKERS:-3} -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000 --max-requests 2000 --max-requests-jitter 200 --keep-alive 5 --timeout 120 --graceful-timeout 30 --access-logfile -"]
