#!/usr/bin/env python3
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "10000"))
MAX_INPUT_BYTES = int(os.environ.get("MAX_RADA_BYTES", str(12 * 1024 * 1024)))
MAX_OUTPUT_BYTES = int(os.environ.get("MAX_WAV_BYTES", str(64 * 1024 * 1024)))
DECODE_TIMEOUT_SECONDS = float(os.environ.get("RADA_DECODE_TIMEOUT_SECONDS", "25"))
MAX_CONCURRENCY = max(1, int(os.environ.get("RADA_MAX_CONCURRENCY", "2")))
SHARED_TOKEN = os.environ.get("RADA_SHARED_TOKEN", "").strip()
DECODER_EXE = os.environ.get("RADA_DECODER_EXE", "/opt/radadec/radadec.exe")
WINE = (
    os.environ.get("WINE_BIN", "").strip()
    or shutil.which("wine64")
    or shutil.which("wine")
    or ("/usr/lib/wine/wine64" if os.path.exists("/usr/lib/wine/wine64") else "")
)

slots = threading.BoundedSemaphore(MAX_CONCURRENCY)


def json_bytes(payload):
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "FNAA-RADA/1.0"

    def log_message(self, fmt, *args):
        return

    def _send(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, message):
        self._send(
            status,
            json_bytes({"ok": False, "code": code, "error": message}),
            "application/json; charset=utf-8",
        )

    def do_GET(self):
        if self.path == "/healthz":
            ready = bool(WINE and os.path.isfile(DECODER_EXE))
            self._send(
                200 if ready else 503,
                json_bytes(
                    {
                        "ok": ready,
                        "service": "fnaa-rada-decoder",
                        "decoder": "radadec",
                        "maxInputBytes": MAX_INPUT_BYTES,
                        "maxConcurrency": MAX_CONCURRENCY,
                    }
                ),
                "application/json; charset=utf-8",
            )
            return
        self._error(404, "NOT_FOUND", "Not found.")

    def do_POST(self):
        if self.path != "/decode":
            self._error(404, "NOT_FOUND", "Not found.")
            return

        if SHARED_TOKEN:
            supplied = self.headers.get("X-NovaSparx-Token", "")
            if not hmac.compare_digest(supplied, SHARED_TOKEN):
                self._error(401, "UNAUTHORIZED", "Invalid decoder token.")
                return

        if not WINE or not os.path.isfile(DECODER_EXE):
            self._error(503, "DECODER_UNAVAILABLE", "RADA decoder is unavailable.")
            return

        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "")
        except ValueError:
            length = -1

        if length <= 0:
            self._error(411, "LENGTH_REQUIRED", "A bounded Content-Length is required.")
            return

        if length > MAX_INPUT_BYTES:
            self._error(413, "RADA_TOO_LARGE", "RADA payload exceeds the decoder byte limit.")
            return

        if not slots.acquire(timeout=2):
            self._error(503, "DECODER_BUSY", "RADA decoder is busy.")
            return

        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self._error(400, "TRUNCATED_INPUT", "RADA payload ended early.")
                return

            with tempfile.TemporaryDirectory(prefix="fnaa-rada-", dir="/tmp") as temp:
                source = os.path.join(temp, "input.rada")
                output = os.path.join(temp, "output.wav")

                with open(source, "wb") as handle:
                    handle.write(data)

                env = os.environ.copy()
                env.setdefault("WINEDEBUG", "-all")

                try:
                    result = subprocess.run(
                        [WINE, DECODER_EXE, "-i", source, "-o", output],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        timeout=DECODE_TIMEOUT_SECONDS,
                        check=False,
                        env=env,
                    )
                except subprocess.TimeoutExpired:
                    self._error(504, "DECODE_TIMEOUT", "RADA decode timed out.")
                    return

                if result.returncode != 0 or not os.path.isfile(output):
                    self._error(422, "DECODE_FAILED", "RADA decoder rejected this payload.")
                    return

                size = os.path.getsize(output)
                if size <= 44 or size > MAX_OUTPUT_BYTES:
                    self._error(422, "INVALID_WAV_SIZE", "Decoded WAV size is invalid.")
                    return

                with open(output, "rb") as handle:
                    wav = handle.read(MAX_OUTPUT_BYTES + 1)

                if (
                    len(wav) > MAX_OUTPUT_BYTES
                    or wav[:4] != b"RIFF"
                    or wav[8:12] != b"WAVE"
                ):
                    self._error(422, "INVALID_WAV", "Decoder did not produce a valid RIFF/WAVE file.")
                    return

                self._send(
                    200,
                    wav,
                    "audio/wav",
                    {
                        "X-NovaSparx-Decoder": "rada-to-wav",
                        "X-NovaSparx-Input-Bytes": str(len(data)),
                    },
                )
        finally:
            slots.release()


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
