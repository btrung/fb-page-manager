"""
Vector DB Service — ChromaDB
Mỗi user/page có 1 collection riêng
"""
import chromadb
from chromadb.config import Settings as ChromaSettings
from app.config import settings


class VectorService:
    def __init__(self):
        self.client = chromadb.PersistentClient(
            path=settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )

    def _collection_name(self, user_id: str, page_id: str) -> str:
        """Tên collection theo pattern: user_{user_id}_page_{page_id}"""
        return f"user_{user_id}_page_{page_id}"

    def upsert_posts(
        self,
        user_id: str,
        page_id: str,
        post_ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict],
    ) -> int:
        """Lưu hoặc cập nhật embeddings của posts vào ChromaDB"""
        collection = self.client.get_or_create_collection(
            name=self._collection_name(user_id, page_id),
            metadata={"hnsw:space": "cosine"},
        )
        collection.upsert(
            ids=post_ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        return len(post_ids)

    def search_similar(
        self,
        user_id: str,
        page_id: str,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> list[dict]:
        """Tìm posts tương tự theo query embedding"""
        collection_name = self._collection_name(user_id, page_id)
        try:
            collection = self.client.get_collection(name=collection_name)
        except Exception:
            return []

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )

        posts = []
        for i in range(len(results["ids"][0])):
            posts.append({
                "id": results["ids"][0][i],
                "content": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "score": round(1 - results["distances"][0][i], 4),
            })
        return posts

    def get_collection_count(self, user_id: str, page_id: str) -> int:
        """Số lượng posts đã được index"""
        try:
            collection = self.client.get_collection(
                name=self._collection_name(user_id, page_id)
            )
            return collection.count()
        except Exception:
            return 0


vector_service = VectorService()
