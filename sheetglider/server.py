"""Local server: serves the browser app and turns rendered frames into video files via ffmpeg."""
import json
import queue
import shutil
import socket
import subprocess
import threading
import time
import uuid
import zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"

# Encoder settings per output format. All of them keep the alpha channel.
FORMATS = {
    "prores": {
        "ext": ".mov",
        # prores_aw is ~2.5x faster than prores_ks and also writes 4444 with alpha.
        "args": ["-c:v", "prores_aw", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
                 "-vendor", "apl0"],
    },
    "webm": {
        "ext": ".webm",
        "args": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "20",
                 "-row-mt", "1", "-auto-alt-ref", "0"],
    },
    "png": {"ext": "", "args": ["-pix_fmt", "rgba", "-f", "image2"]},  # PNG sequence in a folder
}

# Frames arrive as raw RGBA straight from WebGL: bottom-up rows and premultiplied
# alpha. Flip them and convert to straight alpha, which video editors expect.
INPUT_FILTER = "vflip,format=gbrap,unpremultiply=inplace=1"

MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".png": "image/png",
    ".svg": "image/svg+xml", ".otf": "font/otf", ".woff2": "font/woff2",
    ".musicxml": "application/xml", ".xml": "application/xml",
}


class ExportJob:
    def __init__(self, fmt, fps, name, width, height):
        if fmt not in FORMATS:
            raise ValueError(f"unknown format {fmt!r}")
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found on PATH")
        self.frame_bytes = width * height * 4
        self.next_index = 0
        self.lock = threading.Lock()
        OUTPUT.mkdir(exist_ok=True)
        safe = "".join(c for c in name if c.isalnum() or c in "-_") or "sheetglider"
        stem = f"{safe}_{time.strftime('%Y%m%d-%H%M%S')}"
        if fmt == "png":
            self.path = OUTPUT / stem
            self.path.mkdir()
            target = self.path / "frame_%05d.png"
        else:
            self.path = OUTPUT / (stem + FORMATS[fmt]["ext"])
            target = self.path
        self.log_path = OUTPUT / (stem + ".ffmpeg.log")
        self.log = open(self.log_path, "wb")
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
               "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{width}x{height}",
               "-framerate", str(fps), "-i", "-", "-vf", INPUT_FILTER,
               *FORMATS[fmt]["args"], str(target)]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=self.log)
        # Frames are handed to ffmpeg on a separate thread so the browser can keep
        # rendering while ffmpeg encodes. The small queue limit keeps memory bounded.
        self.error = None
        self.queue = queue.Queue(maxsize=8)
        self.writer = threading.Thread(target=self._write_loop, daemon=True)
        self.writer.start()

    def _write_loop(self):
        while (item := self.queue.get()) is not None:
            if self.error:
                continue  # keep draining so nobody blocks on a full queue
            compressed, index, data = item
            try:
                if compressed:
                    data = zlib.decompress(data)
                if len(data) != self.frame_bytes:
                    raise ValueError(f"frame {index}: expected {self.frame_bytes} bytes, got {len(data)}")
                self.proc.stdin.write(data)
            except Exception as exc:
                self.error = str(exc)

    def add_frame(self, index, data, compressed):
        with self.lock:
            if self.error:
                raise RuntimeError(self.error)
            if index != self.next_index:
                raise ValueError(f"expected frame {self.next_index}, got {index}")
            self.next_index += 1
            self.queue.put((compressed, index, data))  # blocks if ffmpeg falls behind

    def finish(self):
        self.queue.put(None)
        self.writer.join()
        self.proc.stdin.close()
        code = self.proc.wait(timeout=600)
        self.log.close()
        log = self.log_path.read_text(errors="replace")[-2000:]
        if code == 0 and not log.strip() and not self.error:
            self.log_path.unlink()
        ok = code == 0 and not self.error
        return {"ok": ok, "path": str(self.path), "frames": self.next_index,
                "log": self.error or log}

    def cancel(self):
        self.error = "cancelled"
        self.proc.kill()
        self.queue.put(None)
        self.writer.join()
        self.proc.wait()
        self.log.close()
        self.log_path.unlink(missing_ok=True)
        if self.path.is_dir():
            shutil.rmtree(self.path, ignore_errors=True)
        else:
            self.path.unlink(missing_ok=True)


JOBS = {}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep connections alive between frame uploads
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **MIME}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0)))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/app/")
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif path == "/api/info":
            self.send_json({"ffmpeg": shutil.which("ffmpeg") is not None, "output": str(OUTPUT)})
        else:
            super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        # Always consume the body first: connections are kept alive, so leftover
        # bytes would corrupt the next request.
        body = self.read_body()
        try:
            if url.path == "/api/export/start":
                opts = json.loads(body or b"{}")
                job = ExportJob(opts.get("format", "prores"), int(opts.get("fps", 60)),
                                opts.get("name", "sheetglider"),
                                int(opts["width"]), int(opts["height"]))
                job_id = uuid.uuid4().hex
                JOBS[job_id] = job
                self.send_json({"id": job_id, "path": str(job.path)})
            elif url.path == "/api/export/frame":
                job = JOBS[query["id"][0]]
                job.add_frame(int(query["i"][0]), body, query.get("z") == ["1"])
                self.send_json({"ok": True})
            elif url.path == "/api/export/finish":
                self.send_json(JOBS.pop(query["id"][0]).finish())
            elif url.path == "/api/export/cancel":
                job = JOBS.pop(query["id"][0], None)
                if job:
                    job.cancel()
                self.send_json({"ok": True})
            else:
                self.send_json({"error": "not found"}, 404)
        except Exception as exc:  # report errors to the browser instead of dropping the connection
            self.send_json({"error": str(exc)}, 500)


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def serve(port=8765):
    """Listens on 127.0.0.1, and on ::1 too when available.

    Browsers try "localhost" over IPv6 first; with nothing listening there, every
    new connection on Windows stalls before falling back to IPv4.
    """
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        v6 = IPv6Server(("::1", port), Handler)
        threading.Thread(target=v6.serve_forever, daemon=True).start()
    except OSError:
        pass  # no IPv6 loopback; IPv4 alone still works
    return server
