"""Media downloader for Cloud.

Takes post links (X, Instagram, Facebook, TikTok, ...), fetches the media with
gallery-dl or yt-dlp, and uploads the files into the requesting user's Nextcloud
over WebDAV. Every request carries the user's Nextcloud app password (the same
one the Cloud app uses); it is checked against Nextcloud and kept in memory only
while that user's jobs run.

Reached only through the Cloud proxy at /dl/api/*. Standard library only.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import ipaddress
import json
import math
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Where Nextcloud answers (host:port on the Docker network) and the name it trusts
# (one of its trusted_domains), sent as the Host header.
NC_HOST, _, _port = os.environ.get("NEXTCLOUD_UPSTREAM", "nextcloud:80").partition(":")
NC_PORT = int(_port or 80)
NC_HOSTNAME = os.environ.get("NEXTCLOUD_HOSTNAME", "localhost")
DATA = Path(os.environ.get("DATA_DIR", "/data"))
TARGET_ROOT = os.environ.get("TARGET_DIR", "/Downloads")
WORKERS = int(os.environ.get("WORKERS", "2"))
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "1800"))
KEEP_JOBS = 200

COOKIES = DATA / "cookies"
JOBS_FILE = DATA / "jobs.json"

# Sites where gallery-dl knows posts best (images, carousels, mixed media);
# everything else goes to yt-dlp first. The other tool is always the fallback.
GALLERY_FIRST = {"twitter", "instagram", "pixiv", "tumblr", "bluesky", "reddit", "pinterest", "deviantart", "danbooru", "kemono"}

SITE_NAMES = {
    "x.com": "twitter", "twitter.com": "twitter", "fxtwitter.com": "twitter", "vxtwitter.com": "twitter",
    "instagram.com": "instagram", "facebook.com": "facebook", "fb.watch": "facebook", "fb.com": "facebook",
    "tiktok.com": "tiktok", "youtube.com": "youtube", "youtu.be": "youtube", "reddit.com": "reddit",
    "redd.it": "reddit", "pixiv.net": "pixiv", "bsky.app": "bluesky", "tumblr.com": "tumblr",
    "threads.net": "threads", "threads.com": "threads", "pinterest.com": "pinterest", "pin.it": "pinterest",
}

lock = threading.Lock()
jobs: dict[str, dict] = {}
secrets: dict[str, str] = {}          # job id -> Authorization header, never written to disk
auth_cache: dict[str, tuple[str, float]] = {}
pool = ThreadPoolExecutor(max_workers=WORKERS)


# ---------------------------------------------------------------- helpers

def site_of(url: str) -> str:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    host = re.sub(r"^(www|m|mobile|mbasic|web|vm|vt)\.", "", host)
    for domain, name in SITE_NAMES.items():
        if host == domain or host.endswith("." + domain):
            return name
    parts = host.split(".")
    return parts[-2] if len(parts) >= 2 else (host or "other")


def public_url(url: str) -> bool:
    """Only http(s) links to public addresses: the tools must not be pointed at
    server's own network."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parts.hostname, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip in ipaddress.ip_network("100.64.0.0/10"):
            return False
    return True


def nc_request(method: str, path: str, auth: str, body=None, headers: dict | None = None, length: int | None = None):
    conn = http.client.HTTPConnection(NC_HOST, NC_PORT, timeout=600)
    h = {"Host": NC_HOSTNAME, "Authorization": auth, **(headers or {})}
    if length is not None:
        h["Content-Length"] = str(length)
    conn.request(method, path, body=body, headers=h)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, data


def check_auth(header: str | None) -> str | None:
    """Returns the Nextcloud user for a Basic app-password header, or None."""
    if not header or not header.startswith("Basic "):
        return None
    key = hashlib.sha256(header.encode()).hexdigest()
    hit = auth_cache.get(key)
    if hit and hit[1] > time.time():
        return hit[0]
    try:
        user = base64.b64decode(header[6:]).decode().split(":", 1)[0]
    except Exception:
        return None
    if not user or "/" in user:
        return None
    status, _ = nc_request("PROPFIND", f"/remote.php/dav/files/{urllib.parse.quote(user)}/", header, headers={"Depth": "0"})
    if status != 207:
        return None
    auth_cache[key] = (user, time.time() + 600)
    return user


def dav_path(user: str, path: str) -> str:
    return f"/remote.php/dav/files/{urllib.parse.quote(user)}" + urllib.parse.quote(path)


def ensure_dir(user: str, auth: str, path: str) -> None:
    built = ""
    for seg in [s for s in path.split("/") if s]:
        built += "/" + seg
        status, _ = nc_request("MKCOL", dav_path(user, built), auth)
        if status not in (201, 405):
            raise RuntimeError(f"Could not create folder {built} (HTTP {status})")


def upload(user: str, auth: str, folder: str, file: Path) -> str:
    stem, ext = file.stem, file.suffix
    for n in range(0, 50):
        name = f"{stem}{ext}" if n == 0 else f"{stem} ({n}){ext}"
        target = f"{folder}/{name}"
        with file.open("rb") as fh:
            status, _ = nc_request(
                "PUT", dav_path(user, target), auth, body=fh, length=file.stat().st_size,
                headers={"If-None-Match": "*", "X-OC-Mtime": str(int(time.time()))},
            )
        if status in (201, 204):
            return target
        if status != 412:  # 412: a file with that name already exists
            raise RuntimeError(f"Upload of {name} failed (HTTP {status})")
    raise RuntimeError(f"Too many files named {file.name}")


def clean_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return name[:180] or "file"


save_lock = threading.Lock()


def save_jobs() -> None:
    with lock:
        data = sorted(jobs.values(), key=lambda j: j["created"], reverse=True)[:KEEP_JOBS]
    try:
        with save_lock:
            tmp = JOBS_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(data))
            tmp.replace(JOBS_FILE)
    except OSError as e:  # the list is a convenience; never fail a download over it
        print("could not save jobs.json:", e, flush=True)


def load_jobs() -> None:
    try:
        for j in json.loads(JOBS_FILE.read_text()):
            if j["status"] in ("queued", "running", "uploading"):
                j["status"], j["message"] = "error", "Interrupted by a restart; retry it"
            jobs[j["id"]] = j
    except FileNotFoundError:
        pass
    except Exception as e:  # corrupt file: start empty
        print("jobs.json unreadable:", e, flush=True)


def update(job: dict, **fields) -> None:
    with lock:
        job.update(fields, updated=time.time())
    if fields.get("status") in ("done", "error", "running"):
        save_jobs()


# ---------------------------------------------------------------- tools

def run_tool(cmd: list[str], job: dict, cwd: Path) -> tuple[int, str]:
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    tail: list[str] = []
    deadline = time.time() + JOB_TIMEOUT
    assert proc.stdout
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        tail = (tail + [line])[-40:]
        m = re.search(r"PROGRESS\s+(\S+%)\s*(.*)", line)
        if m:
            update(job, progress=f"{m.group(1).strip()} {m.group(2).strip()}".strip())
        elif line.startswith(str(cwd)):
            update(job, progress=f"{len(list(cwd.iterdir()))} files")
        if time.time() > deadline:
            proc.kill()
            return 1, "Timed out"
    proc.wait()
    return proc.returncode, "\n".join(tail)


def gallery_dl(url: str, out: Path, cookies: Path | None, job: dict) -> tuple[int, str]:
    cmd = [
        "gallery-dl", "--no-mtime", "-D", str(out),
        "-f", "{author[name]|user[name]|owner[username]|username|uploader|category} - "
              "{tweet_id|post_id|shortcode|id|filename} - {num:>02}.{extension}",
        "-o", "videos=true",
    ]
    if cookies:
        cmd += ["--cookies", str(cookies)]
    return run_tool(cmd + [url], job, out)


# ---- X / Twitter without logging in
# Public posts are read the way link-preview services do: FxTwitter's API first
# (handles videos, GIFs and sensitive posts), X's own embed endpoint second.

UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def best_mp4(variants: list[dict]) -> str | None:
    mp4 = [v for v in variants if "mp4" in (v.get("content_type") or v.get("type") or "") or ".mp4" in (v.get("url") or "")]
    mp4.sort(key=lambda v: v.get("bitrate") or 0, reverse=True)
    return mp4[0]["url"] if mp4 else None


def fx_media(tweet_id: str) -> tuple[str, list[str]]:
    t = http_json(f"https://api.fxtwitter.com/status/{tweet_id}")["tweet"]
    urls = []
    for m in (t.get("media") or {}).get("all", []):
        if m.get("type") == "photo":
            urls.append(m["url"].split("?")[0] + "?name=orig")
        else:  # video, gif
            urls.append(best_mp4(m.get("variants") or []) or m["url"])
    return t["author"]["screen_name"], urls


def syndication_token(tweet_id: str) -> str:
    x = (int(tweet_id) / 1e15) * math.pi
    digits, whole, frac, out = "0123456789abcdefghijklmnopqrstuvwxyz", int(x), x - int(x), ""
    while whole:
        out, whole = digits[whole % 36] + out, whole // 36
    out = (out or "0") + "."
    for _ in range(12):
        frac *= 36
        out += digits[int(frac)]
        frac -= int(frac)
    return re.sub(r"(0+|\.)", "", out)


def syndication_media(tweet_id: str) -> tuple[str, list[str]]:
    t = http_json(f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&token={syndication_token(tweet_id)}&lang=en")
    urls = []
    for m in t.get("mediaDetails", []):
        if m.get("type") == "photo":
            urls.append(m["media_url_https"] + "?name=orig")
        else:
            url = best_mp4((m.get("video_info") or {}).get("variants") or [])
            if url:
                urls.append(url)
    return t["user"]["screen_name"], urls


def twitter_api(url: str, out: Path, cookies: Path | None, job: dict) -> tuple[int, str]:
    m = re.search(r"/status(?:es)?/(\d+)", url)
    if not m:
        return 1, "Not a post link"
    tweet_id, log = m.group(1), []
    for name, fn in (("FxTwitter", fx_media), ("X embed", syndication_media)):
        try:
            user, urls = fn(tweet_id)
        except Exception as e:
            log.append(f"{name}: {e}")
            continue
        if not urls:
            log.append(f"{name}: no media in this post")
            continue
        for i, media in enumerate(urls, 1):
            ext = re.search(r"\.(mp4|jpg|jpeg|png|gif|webp)(?:\?|$)", media.split("?name=")[0] + "?")
            ext = ext.group(1) if ext else ("mp4" if "video" in media else "jpg")
            update(job, progress=f"{i} of {len(urls)}")
            req = urllib.request.Request(media, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r, (out / f"{user} - {tweet_id} - {i:02}.{ext}").open("wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
        return 0, ""
    return 1, "\n".join(log)


def name_template(site: str) -> str:
    """account - post id for social sites; title for everything else."""
    if site == "tiktok":
        return "%(uploader,uploader_id|unknown)s - %(id)s.%(ext)s"
    if site in set(SITE_NAMES.values()):
        return "%(uploader_id,uploader,channel|unknown)s - %(id)s.%(ext)s"
    return "%(title).120B - %(id)s.%(ext)s"


def yt_dlp(url: str, out: Path, cookies: Path | None, job: dict) -> tuple[int, str]:
    cmd = [
        "yt-dlp", "--newline", "--no-mtime", "--no-part", "--progress",
        "--progress-template", "download:PROGRESS %(progress._percent_str)s %(progress._total_bytes_str)s",
        "-f", "bv*+ba/b", "--merge-output-format", "mp4", "--max-filesize", "4G",
        "--playlist-items", "1:50",
        "-o", str(out / name_template(job["site"])),
        "--no-write-thumbnail",
    ]
    if cookies:
        cmd += ["--cookies", str(cookies)]
    return run_tool(cmd + [url], job, out)


def summarize_error(log: str) -> str:
    lines = [l for l in log.splitlines() if re.search(r"error|unable|login|not found|unsupported|private|429|403|401", l, re.I)]
    msg = (lines[-1] if lines else (log.splitlines() or ["Nothing was downloaded"])[-1]).strip()
    msg = re.sub(r"^\[[^\]]+\]\s*", "", re.sub(r"^ERROR:\s*", "", msg))
    if re.search(r"login|cookies|authenticat|rate.?limit|not available", msg, re.I):
        msg += " (adding cookies for this site in Download settings usually fixes this)"
    return msg[:400]


def process(job_id: str) -> None:
    job = jobs[job_id]
    auth = secrets.get(job_id)
    if not auth:
        update(job, status="error", message="Sign-in expired; retry")
        return
    user, url, site = job["user"], job["url"], job["site"]
    cookie_file = COOKIES / f"{user}.txt"
    cookies = cookie_file if cookie_file.exists() else None
    tmp = Path(tempfile.mkdtemp(prefix="dl-", dir=DATA / "tmp"))
    try:
        update(job, status="running", progress="Starting")
        order = [gallery_dl, yt_dlp] if site in GALLERY_FIRST else [yt_dlp, gallery_dl]
        if site == "twitter":
            order = [twitter_api] + order
        logs = []
        for tool in order:
            for f in tmp.iterdir():
                f.unlink() if f.is_file() else shutil.rmtree(f)
            code, log = tool(url, tmp, cookies, job)
            files = [f for f in tmp.rglob("*") if f.is_file() and not f.name.endswith((".part", ".ytdl", ".json"))]
            if files:
                break
            logs.append(log)
        else:
            update(job, status="error", message=summarize_error("\n".join(logs)), progress="")
            return

        folder = f"{TARGET_ROOT}/{site}"
        update(job, status="uploading", progress=f"0 of {len(files)} saved")
        ensure_dir(user, auth, folder)
        saved = []
        for i, f in enumerate(sorted(files)):
            renamed = f.with_name(clean_name(f.name))
            if renamed != f:
                f.rename(renamed)
            saved.append(upload(user, auth, folder, renamed))
            update(job, progress=f"{i + 1} of {len(files)} saved")
        update(job, status="done", files=saved, folder=folder, progress="", message=f"{len(saved)} file{'s' if len(saved) != 1 else ''} saved")
    except Exception as e:
        update(job, status="error", message=str(e)[:400], progress="")
    finally:
        secrets.pop(job_id, None)
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- http api

def public_job(j: dict) -> dict:
    return {k: v for k, v in j.items() if k != "user"}


class Handler(BaseHTTPRequestHandler):
    server_version = "cloud-dl"
    sys_version = ""

    def log_message(self, fmt, *args):  # keep links (which can be personal) out of the log
        print(f"{self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}", flush=True)

    def send(self, status: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self, limit: int = 1_000_000) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("Request too large")
        return self.rfile.read(n)

    def user(self) -> str | None:
        u = check_auth(self.headers.get("Authorization"))
        if not u:
            self.send(401, {"error": "Not signed in"})
        return u

    def do_GET(self):
        user = self.user()
        if not user:
            return
        path = self.path.split("?")[0]
        if path == "/dl/api/jobs":
            with lock:
                mine = [public_job(j) for j in jobs.values() if j["user"] == user]
            mine.sort(key=lambda j: j["created"], reverse=True)
            return self.send(200, {"jobs": mine[:100]})
        if path == "/dl/api/cookies":
            f = COOKIES / f"{user}.txt"
            if not f.exists():
                return self.send(200, {"domains": [], "updated": None})
            domains = sorted({
                l.split("\t")[0].lstrip(".").removeprefix("#HttpOnly_").lstrip(".")
                for l in f.read_text(errors="ignore").splitlines()
                if l.count("\t") >= 6 and (not l.startswith("#") or l.startswith("#HttpOnly_"))
            })
            return self.send(200, {"domains": domains, "updated": f.stat().st_mtime})
        self.send(404, {"error": "Not found"})

    def do_POST(self):
        user = self.user()
        if not user:
            return
        path = self.path.split("?")[0]
        try:
            data = json.loads(self.body() or b"{}")
        except ValueError:
            return self.send(400, {"error": "Bad request"})
        if path == "/dl/api/jobs":
            urls = data.get("urls") or ([data["url"]] if data.get("url") else [])
            urls = [u.strip() for u in urls if isinstance(u, str) and u.strip()][:20]
            if not urls:
                return self.send(400, {"error": "No link given"})
            created = []
            recent = time.time() - 600
            for url in urls:
                if not public_url(url):
                    return self.send(400, {"error": f"Not a public web link: {url[:100]}"})
            for url in urls:
                # The same link again within 10 minutes (a Share that fired twice, an
                # app reopened on the old address): report the existing download.
                with lock:
                    same = next((j for j in jobs.values() if j["user"] == user and j["url"] == url
                                 and j["created"] > recent and j["status"] != "error"), None)
                if same:
                    created.append({**public_job(same), "duplicate": True})
                    continue
                jid = uuid.uuid4().hex[:12]
                job = {"id": jid, "user": user, "url": url, "site": site_of(url), "status": "queued", "message": "",
                       "progress": "", "files": [], "folder": "", "created": time.time(), "updated": time.time()}
                with lock:
                    jobs[jid] = job
                secrets[jid] = self.headers["Authorization"]
                pool.submit(process, jid)
                created.append(public_job(job))
            save_jobs()
            return self.send(201, {"jobs": created})
        m = re.fullmatch(r"/dl/api/jobs/([0-9a-f]{12})/retry", path)
        if m and m.group(1) in jobs and jobs[m.group(1)]["user"] == user:
            job = jobs[m.group(1)]
            if job["status"] in ("queued", "running", "uploading"):
                return self.send(409, {"error": "Already running"})
            update(job, status="queued", message="", progress="", files=[])
            secrets[job["id"]] = self.headers["Authorization"]
            pool.submit(process, job["id"])
            return self.send(200, {"job": public_job(job)})
        self.send(404, {"error": "Not found"})

    def do_PUT(self):
        user = self.user()
        if not user:
            return
        if self.path.split("?")[0] != "/dl/api/cookies":
            return self.send(404, {"error": "Not found"})
        try:
            text = self.body(5_000_000).decode("utf-8", errors="replace")
        except ValueError as e:
            return self.send(413, {"error": str(e)})
        rows = [l for l in text.splitlines() if l.count("\t") >= 6]
        if not rows:
            return self.send(400, {"error": "That doesn't look like a cookies.txt file (Netscape format)"})
        COOKIES.mkdir(parents=True, exist_ok=True)
        f = COOKIES / f"{user}.txt"
        f.write_text("# Netscape HTTP Cookie File\n" + "\n".join(rows) + "\n")
        f.chmod(0o600)
        self.send(200, {"ok": True, "rows": len(rows)})

    def do_DELETE(self):
        user = self.user()
        if not user:
            return
        path = self.path.split("?")[0]
        if path == "/dl/api/cookies":
            (COOKIES / f"{user}.txt").unlink(missing_ok=True)
            return self.send(200, {"ok": True})
        m = re.fullmatch(r"/dl/api/jobs/([0-9a-f]{12})", path)
        if m and m.group(1) in jobs and jobs[m.group(1)]["user"] == user:
            if jobs[m.group(1)]["status"] in ("queued", "running", "uploading"):
                return self.send(409, {"error": "Still running"})
            with lock:
                del jobs[m.group(1)]
            save_jobs()
            return self.send(200, {"ok": True})
        self.send(404, {"error": "Not found"})


def main() -> None:
    (DATA / "tmp").mkdir(parents=True, exist_ok=True)
    for leftover in (DATA / "tmp").iterdir():
        shutil.rmtree(leftover, ignore_errors=True)
    COOKIES.mkdir(parents=True, exist_ok=True)
    load_jobs()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    print("cloud-dl listening on :8000", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
