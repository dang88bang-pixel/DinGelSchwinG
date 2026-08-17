"""Dynamic download + import of controller parsers (GitHub Releases / S3).

A driver is distributed as a **zip of a Python package** whose module exposes a
`PARSER_CLASS` attribute (a `ControllerParser` subclass). The loader downloads
the archive, imports it in an isolated namespace without touching the process
`sys.path` permanently, and registers the resulting parser in the registry.

Security note: this loads third-party code at runtime. In production, gate this
endpoint behind authentication and/or pin releases + checksums.
"""
from __future__ import annotations

import importlib.util
import io
import logging
import zipfile
from typing import Type

import httpx

from ..config import settings
from .base import ControllerParser
from .registry import ParserRegistry, registry

logger = logging.getLogger(__name__)


class DynamicLoader:
    """Downloads parser packages from GitHub Releases or an S3 bucket."""

    def __init__(self, target: ParserRegistry | None = None) -> None:
        self._registry = target or registry

    # -- public API --------------------------------------------------------

    async def load_from_github(self, release_url: str) -> str:
        """Download + register a parser archive from a GitHub Release URL."""
        logger.info("Loading parser from GitHub release: %s", release_url)
        async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
            resp = await client.get(release_url)
            resp.raise_for_status()
        return self._install_zip(resp.content)

    async def load_from_s3(self, key: str) -> str:
        """Download + register a parser archive from the configured S3 bucket."""
        import boto3
        from botocore import UNSIGNED
        from botocore.config import Config

        bucket = settings.driver_s3_bucket
        if not bucket:
            raise RuntimeError("driver_s3_bucket is not configured")

        full_key = f"{settings.driver_s3_prefix.rstrip('/')}/{key.lstrip('/')}"
        logger.info("Loading parser from s3://%s/%s", bucket, full_key)

        # boto3 is sync; run the GET in a worker thread.
        import asyncio

        def _get() -> bytes:
            s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))
            buf = io.BytesIO()
            s3.download_fileobj(bucket, full_key, buf)
            return buf.getvalue()

        data = await asyncio.to_thread(_get)
        return self._install_zip(data)

    # -- internals ---------------------------------------------------------

    def _install_zip(self, archive: bytes) -> str:
        """Import the parser module from an in-memory zip and register it."""
        zf = zipfile.ZipFile(io.BytesIO(archive))
        names = zf.namelist()

        # Locate the parser module: prefer a top-level `parser.py`.
        module_name = self._find_parser_module(names)
        if module_name is None:
            raise ValueError("Archive does not contain a parser.py module")

        source = zf.read(f"{module_name}.py")
        spec = importlib.util.spec_from_loader(
            f"_moe_dynamic.{module_name}", loader=None
        )
        module = importlib.util.module_from_spec(spec)
        exec(compile(source, f"{module_name}.py", "exec"), module.__dict__)  # noqa: S102

        parser_cls: Type[ControllerParser] | None = getattr(module, "PARSER_CLASS", None)
        if parser_cls is None or not issubclass(parser_cls, ControllerParser):
            raise TypeError(f"Module '{module_name}' must define PARSER_CLASS")

        parser = parser_cls()
        self._registry.register(parser)
        return parser.protocol

    @staticmethod
    def _find_parser_module(names: list[str]) -> str | None:
        """Return the import path of `parser.py` inside the zip (if present)."""
        for name in names:
            if name.endswith("/parser.py"):
                return name[:-3].rstrip("/").replace("/", ".")
        if "parser.py" in names:
            return "parser"
        return None
