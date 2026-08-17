"""Async Neo4j access layer.

Executes the graph context query from the system design:

    MATCH (n {id: $node_id})-[r]->(m) RETURN n, r, m

and normalises the result into a plain dict that can (a) be serialised into the
protobuf `NodeDetails`/`Relationship` messages and (b) be handed to Gemini for
an explanation.
"""
from __future__ import annotations

import logging
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase

logger = logging.getLogger(__name__)

_CONTEXT_QUERY = "MATCH (n {id: $node_id})-[r]->(m) RETURN n, r, m"


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

    async def close(self) -> None:
        await self._driver.close()
