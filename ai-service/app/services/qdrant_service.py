"""
Qdrant Service — vector database cho image embeddings (CLIP) và text embeddings
Thay thế ChromaDB, hỗ trợ tốt hơn cho production
Collections:
  - product_images   : CLIP 512d — ảnh sản phẩm
  - post_embeddings  : OpenAI 1536d — nội dung bài đăng
"""
import logging
from typing import Optional

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
    Filter,
    FieldCondition,
    MatchValue,
    SearchParams,
)

from app.config import settings

logger = logging.getLogger(__name__)

# CLIP 512d cho ảnh, Gemini text-embedding-004 768d cho text
CLIP_DIM = 512
TEXT_DIM = 768


class QdrantService:
    def __init__(self):
        # Truyền api_key nếu có (Qdrant Cloud), bỏ qua nếu local
        self.client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
        )
        self._collections_ready = False

    async def ensure_collections(self):
        """
        Tạo collections nếu chưa tồn tại.
        Gọi khi app startup, idempotent.
        """
        if self._collections_ready:
            return

        existing = {c.name for c in (await self.client.get_collections()).collections}

        # Collection ảnh sản phẩm — CLIP 512d
        if settings.qdrant_collection_images not in existing:
            await self.client.create_collection(
                collection_name=settings.qdrant_collection_images,
                vectors_config=VectorParams(size=CLIP_DIM, distance=Distance.COSINE),
            )
            logger.info(f"[QDRANT] Tạo collection '{settings.qdrant_collection_images}'")

        # Collection text bài đăng — OpenAI 1536d
        if settings.qdrant_collection_posts not in existing:
            await self.client.create_collection(
                collection_name=settings.qdrant_collection_posts,
                vectors_config=VectorParams(size=TEXT_DIM, distance=Distance.COSINE),
            )
            logger.info(f"[QDRANT] Tạo collection '{settings.qdrant_collection_posts}'")

        self._collections_ready = True

    # =============================================
    # Upsert image vectors
    # =============================================

    async def upsert_image_vector(
        self,
        media_id: str,
        vector: list[float],
        payload: dict,
    ) -> bool:
        """
        Lưu/cập nhật vector ảnh vào Qdrant.
        media_id làm key (UUID string → hash thành int id).
        payload: { product_id, post_id, page_id, user_id, image_url, product_name }
        """
        await self.ensure_collections()
        try:
            # Qdrant dùng UUID string hoặc unsigned int làm id
            await self.client.upsert(
                collection_name=settings.qdrant_collection_images,
                points=[
                    PointStruct(
                        id=media_id,  # UUID string được hỗ trợ từ Qdrant 1.x
                        vector=vector,
                        payload=payload,
                    )
                ],
            )
            return True
        except Exception as e:
            logger.error(f"[QDRANT] upsert_image_vector thất bại: {e}")
            return False

    async def upsert_image_vectors_batch(
        self, points: list[dict]
    ) -> int:
        """
        Upsert batch nhiều vectors ảnh.
        points: list of { media_id, vector, payload }
        Trả về số điểm đã upsert thành công.
        """
        await self.ensure_collections()
        if not points:
            return 0

        try:
            qdrant_points = [
                PointStruct(
                    id=p["media_id"],
                    vector=p["vector"],
                    payload=p["payload"],
                )
                for p in points
            ]
            await self.client.upsert(
                collection_name=settings.qdrant_collection_images,
                points=qdrant_points,
            )
            return len(qdrant_points)
        except Exception as e:
            logger.error(f"[QDRANT] upsert_image_vectors_batch thất bại: {e}")
            return 0

    # =============================================
    # Upsert text vectors (post embeddings)
    # =============================================

    async def upsert_post_vector(
        self,
        post_id: str,
        vector: list[float],
        payload: dict,
    ) -> bool:
        """
        Lưu vector text embedding của post.
        payload: { page_id, user_id, product_name, is_sale_post }
        """
        await self.ensure_collections()
        try:
            await self.client.upsert(
                collection_name=settings.qdrant_collection_posts,
                points=[
                    PointStruct(id=post_id, vector=vector, payload=payload)
                ],
            )
            return True
        except Exception as e:
            logger.error(f"[QDRANT] upsert_post_vector thất bại: {e}")
            return False

    # =============================================
    # Search
    # =============================================

    async def search_similar_images(
        self,
        query_vector: list[float],
        user_id: Optional[str] = None,
        top_k: int = 10,
    ) -> list[dict]:
        """
        Tìm ảnh sản phẩm tương tự theo vector CLIP.
        Có thể filter theo user_id.
        """
        await self.ensure_collections()
        try:
            query_filter = None
            if user_id:
                query_filter = Filter(
                    must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
                )

            results = await self.client.search(
                collection_name=settings.qdrant_collection_images,
                query_vector=query_vector,
                limit=top_k,
                query_filter=query_filter,
                search_params=SearchParams(hnsw_ef=128),
                with_payload=True,
            )

            return [
                {
                    "media_id": str(r.id),
                    "score": round(r.score, 4),
                    **r.payload,
                }
                for r in results
            ]
        except Exception as e:
            logger.error(f"[QDRANT] search_similar_images thất bại: {e}")
            return []

    async def search_similar_posts(
        self,
        query_vector: list[float],
        user_id: Optional[str] = None,
        top_k: int = 10,
    ) -> list[dict]:
        """Tìm posts tương tự theo query text embedding."""
        await self.ensure_collections()
        try:
            query_filter = None
            if user_id:
                query_filter = Filter(
                    must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
                )

            results = await self.client.search(
                collection_name=settings.qdrant_collection_posts,
                query_vector=query_vector,
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
            )

            return [
                {"post_id": str(r.id), "score": round(r.score, 4), **r.payload}
                for r in results
            ]
        except Exception as e:
            logger.error(f"[QDRANT] search_similar_posts thất bại: {e}")
            return []

    async def delete_by_user_id(self, user_id: str) -> dict:
        """Xoá toàn bộ vectors của 1 user trong cả 2 collections."""
        await self.ensure_collections()
        user_filter = Filter(
            must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
        )
        results = {}
        for collection in [settings.qdrant_collection_images, settings.qdrant_collection_posts]:
            try:
                await self.client.delete(
                    collection_name=collection,
                    points_selector=user_filter,
                )
                results[collection] = "deleted"
                logger.info(f"[QDRANT] Xoá vectors user={user_id} trong '{collection}'")
            except Exception as e:
                results[collection] = f"error: {e}"
                logger.error(f"[QDRANT] Xoá thất bại collection={collection}: {e}")
        return results

    async def health_check(self) -> dict:
        """Kiểm tra kết nối và trạng thái collections."""
        try:
            collections = await self.client.get_collections()
            names = [c.name for c in collections.collections]
            return {"status": "ok", "collections": names}
        except Exception as e:
            return {"status": "error", "message": str(e)}


# Singleton
qdrant_service = QdrantService()
