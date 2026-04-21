"""
Router /embed — tạo và lưu embeddings
  POST /embed/image       — CLIP embed 1 ảnh → Qdrant
  POST /embed/images-batch — CLIP embed nhiều ảnh → Qdrant
  POST /embed/post-text   — text embed 1 post → Qdrant
  GET  /embed/health      — kiểm tra Qdrant + model
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.image_embedding_service import image_embedding_service
from app.services.embedding_service import embedding_service
from app.services.qdrant_service import qdrant_service

router = APIRouter(prefix="/embed", tags=["embed"])
logger = logging.getLogger(__name__)


# =============================================
# Schemas
# =============================================

class EmbedImageRequest(BaseModel):
    media_id: str              # UUID từ bảng post_media
    image_url: str
    post_id: str
    page_id: str
    user_id: str
    product_id: Optional[str] = None
    product_name: Optional[str] = None


class EmbedImageResponse(BaseModel):
    media_id: str
    success: bool
    vector_dim: Optional[int] = None
    message: str = ""


class BatchImageItem(BaseModel):
    media_id: str
    image_url: str
    post_id: str
    page_id: str
    user_id: str
    product_id: Optional[str] = None
    product_name: Optional[str] = None


class EmbedImagesBatchRequest(BaseModel):
    items: list[BatchImageItem]


class EmbedImagesBatchResponse(BaseModel):
    total: int
    success: int
    failed: int
    results: list[EmbedImageResponse]


class EmbedPostTextRequest(BaseModel):
    post_id: str
    text: str
    page_id: str
    user_id: str
    product_name: Optional[str] = None
    product_id: Optional[str] = None
    is_sale_post: bool = False
    current_price: Optional[int] = None


class EmbedPostTextResponse(BaseModel):
    post_id: str
    success: bool
    vector_dim: Optional[int] = None


# =============================================
# POST /embed/image — embed 1 ảnh
# =============================================

@router.post("/image", response_model=EmbedImageResponse)
async def embed_single_image(req: EmbedImageRequest):
    """
    Download ảnh → CLIP embed → lưu Qdrant.
    Ảnh chỉ tồn tại trong RAM, không lưu file.
    """
    vector = await image_embedding_service.embed_image_url(req.image_url)

    if vector is None:
        return EmbedImageResponse(
            media_id=req.media_id,
            success=False,
            message="Không thể tải hoặc embed ảnh",
        )

    payload = {
        "post_id": req.post_id,
        "page_id": req.page_id,
        "user_id": req.user_id,
        "image_url": req.image_url,
        "product_name": req.product_name,
    }

    ok = await qdrant_service.upsert_image_vector(
        media_id=req.media_id,
        vector=vector,
        payload=payload,
    )

    return EmbedImageResponse(
        media_id=req.media_id,
        success=ok,
        vector_dim=len(vector) if ok else None,
        message="" if ok else "Lưu Qdrant thất bại",
    )


# =============================================
# POST /embed/images-batch — embed nhiều ảnh
# Tối đa 100 ảnh/request
# =============================================

@router.post("/images-batch", response_model=EmbedImagesBatchResponse)
async def embed_images_batch(req: EmbedImagesBatchRequest):
    """
    Download + CLIP embed nhiều ảnh song song → batch upsert Qdrant.
    Worker gọi endpoint này sau mỗi crawl batch.
    """
    if not req.items:
        raise HTTPException(status_code=400, detail="Danh sách items rỗng")

    if len(req.items) > 100:
        raise HTTPException(status_code=400, detail="Tối đa 100 ảnh/request")

    logger.info(f"[EMBED] batch {len(req.items)} ảnh")

    # Lấy tất cả URLs để embed song song
    urls = [item.image_url for item in req.items]
    vectors = await image_embedding_service.embed_image_urls_batch(urls)

    # Chuẩn bị batch upsert cho những ảnh embed thành công
    qdrant_points = []
    results = []
    success_count = 0
    failed_count = 0

    for item, vector in zip(req.items, vectors):
        if vector is None:
            results.append(EmbedImageResponse(
                media_id=item.media_id,
                success=False,
                message="Embed thất bại",
            ))
            failed_count += 1
            continue

        qdrant_points.append({
            "media_id": item.media_id,
            "vector": vector,
            "payload": {
                "post_id": item.post_id,
                "page_id": item.page_id,
                "user_id": item.user_id,
                "image_url": item.image_url,
                "product_name": item.product_name,
            },
        })
        results.append(EmbedImageResponse(
            media_id=item.media_id,
            success=True,
            vector_dim=len(vector),
        ))
        success_count += 1

    # Batch upsert vào Qdrant
    if qdrant_points:
        saved = await qdrant_service.upsert_image_vectors_batch(qdrant_points)
        if saved < len(qdrant_points):
            logger.warning(f"[EMBED] Qdrant chỉ lưu {saved}/{len(qdrant_points)}")

    return EmbedImagesBatchResponse(
        total=len(req.items),
        success=success_count,
        failed=failed_count,
        results=results,
    )


# =============================================
# POST /embed/post-text — embed text của post
# =============================================

@router.post("/post-text", response_model=EmbedPostTextResponse)
async def embed_post_text(req: EmbedPostTextRequest):
    """
    Tạo text embedding (OpenAI 1536d) cho post → lưu Qdrant.
    Trả về vector để caller lưu vào PostgreSQL posts.post_embedding.
    """
    if not req.text.strip():
        return EmbedPostTextResponse(post_id=req.post_id, success=False)

    try:
        vectors = await embedding_service.embed_texts([req.text])
        vector = vectors[0]
    except Exception as e:
        logger.error(f"[EMBED] text embed thất bại post {req.post_id}: {e}")
        return EmbedPostTextResponse(post_id=req.post_id, success=False)

    ok = await qdrant_service.upsert_post_vector(
        post_id=req.post_id,
        vector=vector,
        payload={
            "page_id": req.page_id,
            "user_id": req.user_id,
            "product_name": req.product_name,
            "current_price": req.current_price,
        },
    )

    return EmbedPostTextResponse(
        post_id=req.post_id,
        success=ok,
        vector_dim=len(vector) if ok else None,
    )


# =============================================
# DELETE /embed/user/{user_id} — xoá toàn bộ vectors của user
# =============================================

@router.delete("/user/{user_id}")
async def delete_user_vectors(user_id: str):
    """Xoá toàn bộ vectors (ảnh + text) của user trong Qdrant."""
    result = await qdrant_service.delete_by_user_id(user_id)
    return {"user_id": user_id, "deleted": result}


# =============================================
# GET /embed/health
# =============================================

@router.get("/health")
async def embed_health():
    """Kiểm tra Qdrant kết nối và CLIP model đã load chưa."""
    from app.services.image_embedding_service import _clip_model

    qdrant_status = await qdrant_service.health_check()
    clip_loaded = _clip_model is not None

    return {
        "qdrant": qdrant_status,
        "clip_model_loaded": clip_loaded,
        "clip_model_name": "clip-ViT-B-32",
        "clip_vector_dim": 512,
        "text_model": "paraphrase-multilingual-MiniLM-L12-v2",
        "text_vector_dim": 384,
    }
