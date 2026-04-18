"""
Vector DB Service — wrapper dùng QdrantService (thay ChromaDB)
"""
from app.services.qdrant_service import qdrant_service


class VectorService:

    async def upsert_posts(
        self,
        user_id: str,
        page_id: str,
        post_ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict],
    ) -> int:
        count = 0
        for post_id, vector, meta in zip(post_ids, embeddings, metadatas):
            payload = {"user_id": user_id, "page_id": page_id, **meta}
            ok = await qdrant_service.upsert_post_vector(post_id, vector, payload)
            if ok:
                count += 1
        return count

    async def search_similar(
        self,
        user_id: str,
        page_id: str,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> list[dict]:
        results = await qdrant_service.search_similar_posts(
            query_vector=query_embedding,
            user_id=user_id,
            top_k=top_k,
        )
        return [
            {
                "id": r["post_id"],
                "content": r.get("content", ""),
                "metadata": {k: v for k, v in r.items() if k not in ("post_id", "score", "content")},
                "score": r["score"],
            }
            for r in results
        ]

    async def get_collection_count(self, user_id: str, page_id: str) -> int:
        try:
            health = await qdrant_service.health_check()
            return 0 if health["status"] != "ok" else -1
        except Exception:
            return 0


vector_service = VectorService()
