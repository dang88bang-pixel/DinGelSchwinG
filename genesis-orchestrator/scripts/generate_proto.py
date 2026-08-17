#!/usr/bin/env python3
"""Regenerate the Python protobuf bindings from `proto/telemetry.proto`.

Usage:
    pip install grpcio-tools
    python scripts/generate_proto.py
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROTO = ROOT / "proto" / "telemetry.proto"
OUT = ROOT / "fastapi-backend" / "app" / "proto"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"-I{ROOT / 'proto'}",
        f"--python_out={OUT}",
        str(PROTO),
    ]
    print(" ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
