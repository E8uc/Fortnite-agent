FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WINEDEBUG=-all \
    WINEPREFIX=/tmp/wine

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl wine wine64 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/radadec

# Pin the original author's GitHub release asset by immutable asset id.
RUN curl -fL \
    -H "Accept: application/octet-stream" \
    "https://api.github.com/repos/GhostScissors/RadA-Decoder/releases/assets/237806458" \
    -o /opt/radadec/radadec.exe \
    && test -s /opt/radadec/radadec.exe

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 10000

CMD ["python3", "/app/app.py"]
