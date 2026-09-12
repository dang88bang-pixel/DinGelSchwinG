#!/usr/bin/env bash
# Produktionsskript: Sichert Konfigurationsdateien als Archiv.
set -euo pipefail

SRC="${1:-data/scripts}"
OUT="${2:-/tmp/dingelschwing_backup_$(date +%s).tar.gz}"

if [ ! -d "$SRC" ]; then
  echo "FEHLER: Quellverzeichnis '$SRC' existiert nicht" >&2
  exit 1
fi

tar -czf "$OUT" -C "$SRC" .
echo "OK: Backup erstellt → $OUT"
ls -lh "$OUT"
