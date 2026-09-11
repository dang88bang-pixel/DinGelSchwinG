"""Async Neo4j access layer.

Executes the graph context query from the system design:

    MATCH (n {id: $node_id})-[r]->(m) RETURN n, r, m

and normalises the result into a plain dict that can (a) be serialised into the
protobuf `NodeDetails`/`Relationship` messages and (b) be handed to Gemini for
an explanation.
"""
from __future__ import annotations

import logging
import math
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase

logger = logging.getLogger(__name__)

_CONTEXT_QUERY = "MATCH (n {id: $node_id})-[r]->(m) RETURN n, r, m"
_GRAPH_QUERY = (
    "MATCH (n) "
    "OPTIONAL MATCH (n)-[r]->(m) "
    "RETURN n AS node, type(r) AS rel_type, m.id AS target_id "
    "LIMIT $limit"
)


class Neo4jService:
    """Thin wrapper around the async Neo4j driver."""

    def __init__(self, uri: str, user: str, password: str, database: str = "neo4j") -> None:
        self._database = database
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(
            uri, auth=(user, password), connection_timeout=10
        )

    async def verify_connectivity(self) -> None:
        """Raise if the database is unreachable (used on startup)."""
        await self._driver.verify_connectivity()

    async def get_node_context(self, node_id: str) -> dict[str, Any] | None:
        """Return the node's properties plus its outgoing relationships.

        Returns ``None`` when the node does not exist in the graph.
        """
        async with self._driver.session(database=self._database) as session:
            result = await session.run(_CONTEXT_QUERY, node_id=node_id)
            records = [record async for record in result]

        if not records:
            return None

        # The node record is identical across rows; use the first one.
        node = records[0]["n"]
        properties: dict[str, Any] = dict(node)

        relationships: list[dict[str, Any]] = []
        neighbours: list[dict[str, Any]] = []
        for record in records:
            rel = record["r"]
            other = record["m"]
            relationships.append(
                {
                    "type": rel.type,
                    "target_id": other.get("id"),
                    "target_label": ",".join(other.labels),
                }
            )
            neighbours.append(dict(other))

        return {
            "node_id": node_id,
            "properties": properties,
            "relationships": relationships,
            "neighbours": neighbours,
        }

    async def get_graph_overview(self, limit: int = 50) -> dict[str, Any]:
        """Return up to ``limit`` nodes plus their outgoing edges.

        Used by ``GET /graph`` to drive the Android node canvas with live
        data instead of hardcoded demo nodes.
        """
        # REAL-IMPLEMENTATION 2026-09-11 (Phase 2.6, additiv)
        async with self._driver.session(database=self._database) as session:
            result = await session.run(_GRAPH_QUERY, limit=max(1, min(int(limit), 200)))
            records = [record async for record in result]

        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        for record in records:
            node = record["node"]
            node_id = str(node.get("id") or node.element_id)
            if node_id not in nodes:
                props = dict(node)
                labels = list(node.labels)
                nodes[node_id] = {
                    "id": node_id,
                    "label": str(props.get("label") or props.get("name") or (labels[0] if labels else node_id)),
                    "type": str(props.get("device_type") or props.get("type") or (labels[0] if labels else "")),
                    "status": str(props.get("status") or "UNKNOWN"),
                }
            rel_type = record["rel_type"]
            target_id = record["target_id"]
            if rel_type and target_id:
                edges.append({"from": node_id, "to": str(target_id), "type": str(rel_type)})

        node_list = list(nodes.values())
        # Deterministic grid layout (canvas space 0..1, same convention as the app).
        cols = max(1, math.ceil(math.sqrt(len(node_list)))) if node_list else 1
        for i, n in enumerate(node_list):
            n["x"] = round(((i % cols) + 0.5) / cols, 3)
            n["y"] = round(((i // cols) + 0.5) / max(1, math.ceil(len(node_list) / cols)), 3)
        return {"nodes": node_list, "edges": edges}

    async def close(self) -> None:
        await self._driver.close()
