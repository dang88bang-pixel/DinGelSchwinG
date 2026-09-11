"""FastAPI entrypoint for the Genesis Orchestrator backend.

Implements the system-design sequence:

    1. Android UI  -> WebSocket (protobuf `ClientRequest`)
    2. Backend     -> async Cypher query against Neo4j (`Neo4jService`)
    3. Backend     -> Gemini explanation of the node context (`GeminiService`)
    4. Backend     -> protobuf `ServerResponse` {node_id, details, ai_summary}

The app also exposes a REST surface for dynamically (re)loading controller
parsers via the Mixture-of-Experts loader.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import settings
from .moe.loader import DynamicLoader
from .moe.registry import registry
from .moe.parsers.ninebot import NinebotParser
from .moe.parsers.vesc import VescParser
from .proto import telemetry_pb2
from .services.gemini_service import GeminiService
from .services.neo4j_service import Neo4jService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("genesis.backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Wire up the service singletons and register bundled parsers."""
    app.state.neo4j = Neo4jService(
        settings.neo4j_uri,
        settings.neo4j_user,
        settings.neo4j_password,
        settings.neo4j_database,
    )
    app.state.gemini = GeminiService(
        settings.gemini_api_key,
        settings.gemini_model,
        settings.gemini_system_prompt,
    )
    app.state.loader = DynamicLoader(registry)

    registry.register(VescParser())
    registry.register(NinebotParser())

    # Best-effort connectivity check; the WS handler degrades gracefully.
    try:
        await app.state.neo4j.verify_connectivity()
        logger.info("Neo4j reachable at %s", settings.neo4j_uri)
    except Exception:  # noqa: BLE001
        logger.warning("Neo4j not reachable at %s — requests will fail gracefully", settings.neo4j_uri)

    yield

    await app.state.neo4j.close()


app = FastAPI(title="Genesis Orchestrator Backend", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _context_to_proto(context: dict[str, Any]) -> tuple[telemetry_pb2.NodeDetails, list[telemetry_pb2.Relationship]]:
    props = context.get("properties", {})
    details = telemetry_pb2.NodeDetails(
        node_id=str(context.get("node_id", "")),
        label=str(props.get("label") or props.get("name") or ""),
        device_type=str(props.get("device_type") or props.get("type") or ""),
        status=str(props.get("status") or "UNKNOWN"),
        attributes={str(k): str(v) for k, v in props.items() if v is not None},
    )
    relationships = [
        telemetry_pb2.Relationship(
            type=str(rel.get("type", "")),
            target_id=str(rel.get("target_id", "")),
            target_label=str(rel.get("target_label", "")),
        )
        for rel in context.get("relationships", [])
    ]
    return details, relationships


async def handle_get_details(
    request: telemetry_pb2.ClientRequest,
    neo4j: Neo4jService,
    gemini: GeminiService,
) -> telemetry_pb2.ServerResponse:
    response = telemetry_pb2.ServerResponse(
        request_id=request.request_id, node_id=request.node_id
    )

    try:
        context = await neo4j.get_node_context(request.node_id)
    except Exception as exc:  # noqa: BLE001
        response.status = telemetry_pb2.ServerResponse.ERROR
        response.error = f"Neo4j query failed: {exc}"
        return response

    if context is None:
        response.status = telemetry_pb2.ServerResponse.NOT_FOUND
        response.error = f"Node '{request.node_id}' not found"
        return response

    details, relationships = _context_to_proto(context)
    response.details.CopyFrom(details)
    response.relationships.extend(relationships)

    # Enrich with the AI explanation ("Erkläre diesen Switch").
    response.ai_summary = await gemini.explain(context)
    response.status = telemetry_pb2.ServerResponse.OK
    return response


# ---------------------------------------------------------------------------
# WebSocket endpoint (protobuf binary frames)
# ---------------------------------------------------------------------------

@app.websocket(settings.ws_path)
async def telemetry_ws(ws: WebSocket) -> None:
    await ws.accept()
    neo4j: Neo4jService = ws.app.state.neo4j
    gemini: GeminiService = ws.app.state.gemini

    try:
        while True:
            payload = await ws.receive_bytes()
            request = telemetry_pb2.ClientRequest()
            request.ParseFromString(payload)

            logger.info("WS request: node=%s action=%s", request.node_id, request.action)

            if request.action == telemetry_pb2.GET_DETAILS:
                response = await handle_get_details(request, neo4j, gemini)
            elif request.action == telemetry_pb2.PING:
                response = telemetry_pb2.ServerResponse(
                    request_id=request.request_id,
                    node_id=request.node_id,
                    status=telemetry_pb2.ServerResponse.OK,
                    ai_summary="pong",
                )
            else:
                response = telemetry_pb2.ServerResponse(
                    request_id=request.request_id,
                    node_id=request.node_id,
                    status=telemetry_pb2.ServerResponse.ERROR,
                    error=f"Unsupported action: {request.action}",
                )

            await ws.send_bytes(response.SerializeToString())
    except WebSocketDisconnect:
        logger.info("Client disconnected")


# ---------------------------------------------------------------------------
# Dynamic driver loading (REST)
# ---------------------------------------------------------------------------

class GitHubLoadRequest(BaseModel):
    release_url: str


class S3LoadRequest(BaseModel):
    key: str


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "parsers": registry.list()}


@app.get("/drivers")
async def list_drivers() -> dict[str, Any]:
    return {"drivers": registry.list()}


@app.post("/drivers/load/github")
async def load_driver_github(body: GitHubLoadRequest) -> dict[str, Any]:
    try:
        protocol = await app.state.loader.load_from_github(body.release_url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"loaded": protocol, "drivers": registry.list()}


@app.post("/drivers/load/s3")
async def load_driver_s3(body: S3LoadRequest) -> dict[str, Any]:
    try:
        protocol = await app.state.loader.load_from_s3(body.key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"loaded": protocol, "drivers": registry.list()}
