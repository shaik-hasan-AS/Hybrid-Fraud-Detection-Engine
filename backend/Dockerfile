FROM python:3.10-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --default-timeout=100 -r /app/backend/requirements.txt


# Copy application directories
COPY backend /app/backend
COPY ml /app/ml
COPY data /app/data

# The main.py will be executed from within /app/backend
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

