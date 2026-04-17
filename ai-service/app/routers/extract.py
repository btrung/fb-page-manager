"""
Router /extract — nhận post data, trả về thông tin sản phẩm từ LLM
Được gọi bởi backend Node.js worker
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_service import llm_service

router = APIRouter(prefix="/extract", tags=["extract"])
logger = logging.getLogger(__name__)


# =============================================
# Request / Response schemas
# =============================================

class ExtractPostRequest(BaseModel):
    post_id: str
    text: str = ""
    image_urls: list[str] = Field(default_factory=list)


class ExtractPostResponse(BaseModel):
    post_id: str
    extracted_product_name: Optional[str]
    price: Optional[int]
    what_is_product: Optional[str]
    product_count: int
    is_sale_post: bool
    what_is_promotion: Optional[str]


class BatchItem(BaseModel):
    post_id: str
    text: str = ""
    image_urls: list[str] = Field(default_factory=list)


class ExtractBatchRequest(BaseModel):
    posts: list[BatchItem]


class ExtractBatchResponse(BaseModel):
    results: list[ExtractPostResponse]
    total: int
    failed: int


# =============================================
# POST /extract/post — xử lý 1 post
# =============================================

@router.post("/post", response_model=ExtractPostResponse)
async def extract_single_post(req: ExtractPostRequest):
    """
    Trích xuất thông tin sản phẩm từ 1 Facebook post.
    Gọi LLM với text + ảnh (vision), trả về structured JSON.
    """
    if not req.text.strip() and not req.image_urls:
        raise HTTPException(
            status_code=400,
            detail="Post phải có text hoặc ít nhất 1 ảnh"
        )

    logger.info(f"[EXTRACT] post_id={req.post_id} images={len(req.image_urls)}")

    result = await llm_service.extract_post(
        post_text=req.text,
        image_urls=req.image_urls,
    )

    return ExtractPostResponse(post_id=req.post_id, **result)


# =============================================
# POST /extract/batch — xử lý nhiều posts
# Gọi từ crawl worker để giảm overhead HTTP
# =============================================

@router.post("/batch", response_model=ExtractBatchResponse)
async def extract_batch(req: ExtractBatchRequest):
    """
    Xử lý batch posts song song (tối đa 50 posts/request).
    Worker sẽ chia nhỏ nếu batch lớn hơn.
    """
    if not req.posts:
        raise HTTPException(status_code=400, detail="Danh sách posts rỗng")

    if len(req.posts) > 50:
        raise HTTPException(
            status_code=400,
            detail="Tối đa 50 posts/batch. Chia nhỏ request."
        )

    logger.info(f"[EXTRACT] batch {len(req.posts)} posts")

    # Gọi LLM song song
    raw_results = await llm_service.extract_posts_batch([
        {"text": p.text, "image_urls": p.image_urls}
        for p in req.posts
    ])

    responses = []
    failed = 0
    for post, result in zip(req.posts, raw_results):
        # Nếu LLM fail hoàn toàn (is_sale_post=False + tất cả None) vẫn trả về
        if result is None:
            failed += 1
            result = {
                "extracted_product_name": None,
                "price": None,
                "what_is_product": None,
                "product_count": 0,
                "is_sale_post": False,
                "what_is_promotion": None,
            }
        responses.append(ExtractPostResponse(post_id=post.post_id, **result))

    return ExtractBatchResponse(
        results=responses,
        total=len(req.posts),
        failed=failed,
    )
