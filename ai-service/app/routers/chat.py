"""
Router /chat — LLM endpoints cho AI Chat feature
  POST /chat/classify-intent       — phân loại intent + mood + identified_product
  POST /chat/generate-reply        — tạo reply tư vấn + search sản phẩm
  POST /chat/generate-probe        — tạo câu hỏi probe cho cold customer
  POST /chat/generate-clarify      — tạo câu hỏi làm rõ sản phẩm
  POST /chat/generate-confirmation — tạo tin xác nhận đơn hàng
  POST /chat/extract-order         — trích xuất thông tin đặt hàng
  POST /chat/search-by-image       — tìm sản phẩm theo ảnh khách gửi
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.chat_llm_service import (
    classify_intent,
    generate_reply,
    generate_probe,
    generate_clarify,
    generate_confirmation,
    extract_order_info,
)
from app.services.embedding_service import embedding_service
from app.services.image_embedding_service import image_embedding_service
from app.services.qdrant_service import qdrant_service

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


# =============================================
# Schemas
# =============================================

class Message(BaseModel):
    role: str    # 'customer' | 'ai' | 'human'
    content: str


class ClassifyIntentRequest(BaseModel):
    messages: list[Message]


class GenerateReplyRequest(BaseModel):
    customer_message: str
    page_id: str
    user_id: str
    image_url: Optional[str] = None
    top_k: int = 3
    mood: str = "neutral"
    reply_style: Optional[str] = None
    customer_name: Optional[str] = None
    identified_product: Optional[dict] = None


class GenerateProbeRequest(BaseModel):
    customer_message: str


class GenerateClarifyRequest(BaseModel):
    customer_message: str
    identified_product: Optional[dict] = None


class GenerateConfirmationRequest(BaseModel):
    product_name: Optional[str] = None
    price: Optional[int] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class ExtractOrderRequest(BaseModel):
    messages: list[Message]


class SearchByImageRequest(BaseModel):
    image_url: str
    page_id: str
    user_id: str
    top_k: int = 3


# =============================================
# POST /chat/classify-intent
# =============================================

@router.post("/classify-intent")
async def api_classify_intent(body: ClassifyIntentRequest):
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")

    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    result = await classify_intent(messages)
    return result


# =============================================
# POST /chat/generate-reply
# Tìm sản phẩm qua Qdrant rồi generate reply
# =============================================

@router.post("/generate-reply")
async def api_generate_reply(body: GenerateReplyRequest):
    products = []

    # Text search
    try:
        query_vec = await embedding_service.embed_query(body.customer_message)
        text_results = await qdrant_service.search_similar_posts(
            query_vector=query_vec,
            user_id=body.user_id,
            top_k=body.top_k,
        )
        products.extend(text_results)
    except Exception as e:
        logger.warning(f"[CHAT] Text search failed: {e}")

    # Image search nếu khách gửi ảnh
    image_results = []
    if body.image_url:
        try:
            img_vec = await image_embedding_service.embed_image_url(body.image_url)
            if img_vec:
                image_results = await qdrant_service.search_similar_images(
                    user_id=body.user_id,
                    page_id=body.page_id,
                    query_vector=img_vec,
                    top_k=body.top_k,
                )
                products.extend(image_results)
        except Exception as e:
            logger.warning(f"[CHAT] Image search failed: {e}")

    # Dedup theo product_name, lấy score cao nhất
    # search_similar_posts trả về flat dict (payload merged vào top level)
    seen = {}
    for p in products:
        name = p.get("product_name") or p.get("payload", {}).get("product_name") or "unknown"
        if name not in seen or p.get("score", 0) > seen[name].get("score", 0):
            seen[name] = p
    products_deduped = sorted(seen.values(), key=lambda x: x.get("score", 0), reverse=True)[:3]

    reply = await generate_reply(
        body.customer_message,
        products_deduped,
        mood=body.mood,
        reply_style=body.reply_style,
        customer_name=body.customer_name,
        identified_product=body.identified_product,
    )

    # Lấy ảnh sản phẩm từ image_results để đính kèm
    product_images = [
        (r.get("image_url") or r.get("payload", {}).get("image_url"))
        for r in image_results[:2]
        if r.get("image_url") or r.get("payload", {}).get("image_url")
    ]

    return {
        "reply": reply,
        "products": products_deduped,
        "product_images": product_images,
    }


# =============================================
# POST /chat/generate-probe
# =============================================

@router.post("/generate-probe")
async def api_generate_probe(body: GenerateProbeRequest):
    reply = await generate_probe(body.customer_message)
    return {"reply": reply}


# =============================================
# POST /chat/generate-clarify
# =============================================

@router.post("/generate-clarify")
async def api_generate_clarify(body: GenerateClarifyRequest):
    reply = await generate_clarify(body.customer_message, body.identified_product)
    return {"reply": reply}


# =============================================
# POST /chat/generate-confirmation
# =============================================

@router.post("/generate-confirmation")
async def api_generate_confirmation(body: GenerateConfirmationRequest):
    order_info = body.model_dump()
    reply = await generate_confirmation(order_info)
    return {"reply": reply}


# =============================================
# POST /chat/extract-order
# =============================================

@router.post("/extract-order")
async def api_extract_order(body: ExtractOrderRequest):
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")
    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    result = await extract_order_info(messages)
    return result


# =============================================
# POST /chat/search-by-image
# Dùng khi khách gửi ảnh sản phẩm
# =============================================

@router.post("/search-by-image")
async def api_search_by_image(body: SearchByImageRequest):
    vec = await image_embedding_service.embed_image_url(body.image_url)
    if vec is None:
        raise HTTPException(status_code=422, detail="Không thể embed ảnh này")

    results = await qdrant_service.search_similar_images(
        user_id=body.user_id,
        page_id=body.page_id,
        query_vector=vec,
        top_k=body.top_k,
    )
    return {"results": results, "total": len(results)}
