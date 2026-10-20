FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini

RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app
USER app

EXPOSE 8000

# O entrypoint será executável quando app/main.py exportar a aplicação FastAPI.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
