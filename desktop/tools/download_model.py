#!/usr/bin/env python3
"""Lädt ein leichtgewichtiges Embedded-Modell (GGUF) von Hugging Face.

Empfohlen: Qwen2.5-0.5B-Instruct (Q4_K_M, ~400 MB) – passt auf die
Bedürfnisse der App (klein, schnell, deutsch-fähig, Tool-Syntax).

Beispiel:
    python tools/download_model.py
    python tools/download_model.py --model Qwen/Qwen2.5-0.5B-Instruct-GGUF \
        --file qwen2.5-0.5b-instruct-q4_k_m.gguf
    python tools/download_model.py --dry-run   # nur URL zeigen
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request

DEFAULT_REPO = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
DEFAULT_FILE = "qwen2.5-0.5b-instruct-q4_k_m.gguf"
BASE = "https://huggingface.co"
MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "models")

FILES = {
    "qwen2.5-0.5b-instruct-q4_k_m.gguf": "~400 MB – empfohlen (Geschwindigkeit/Qualität)",
    "qwen2.5-0.5b-instruct-q5_k_m.gguf": "~450 MB – etwas besser, minimal langsamer",
    "qwen2.5-0.5b-instruct-q8_0.gguf": "~600 MB – beste Qualität, mehr RAM",
}


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def download(url: str, dest: str, dry_run: bool = False) -> int:
    if dry_run:
        print(f"DRY-RUN: würde herunterladen:\n  {url}\n  → {dest}")
        return 0
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "Dingelschwing-Downloader"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        with open(tmp, "wb") as f:
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // max(total, 1)
                    sys.stdout.write(f"\r  {human(done)} / {human(total)} ({pct}%)   ")
                else:
                    sys.stdout.write(f"\r  {human(done)}   ")
                sys.stdout.flush()
    os.replace(tmp, dest)
    print(f"\n✅ Fertig: {dest} ({human(os.path.getsize(dest))})")
    print("In der GUI: Einstellungen → Modell → 'auto' oder 'llamacpp' wählen.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="GGUF-Modell für den lokalen Agenten laden")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="HuggingFace-Repo")
    parser.add_argument("--file", default=DEFAULT_FILE, help="Dateiname im Repo")
    parser.add_argument("--out", default=None, help="Zielpfad (Default: data/models/<file>)")
    parser.add_argument("--dry-run", action="store_true", help="Nur URL anzeigen")
    parser.add_argument("--list", action="store_true", help="Verfügbare Dateien anzeigen")
    args = parser.parse_args()

    if args.list:
        print("Verfügbare Modell-Dateien in", DEFAULT_REPO)
        for name, desc in FILES.items():
            print(f"  - {name}  ({desc})")
        return 0

    dest = args.out or os.path.join(MODELS_DIR, os.path.basename(args.file))
    url = f"{BASE}/{args.repo}/resolve/main/{args.file}"
    try:
        return download(url, dest, dry_run=args.dry_run)
    except Exception as exc:  # noqa: BLE001
        print(f"❌ Download fehlgeschlagen: {exc}", file=sys.stderr)
        print("Tipp: Netzwerk prüfen oder --file mit einem gültigen Dateinamen angeben.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
