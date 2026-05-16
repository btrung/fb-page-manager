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
from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.chat_llm_service import (
    classify_intent,
    generate_reply,
    generate_probe,
    generate_clarify,
    generate_product_confirm,
    generate_closing_script,
    generate_confirmation,
    extract_order_info,
    extract_order_fields,
    consult_state2,
    consult_state3,
    detect_variants,
    detect_niche,
    rerank_products,
    handle_support,
    handle_general,
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
    message: str
    has_image: bool = False
    current_state: Optional[str] = None   # state0|state1|state2|state3
    recent_messages: Optional[List[Message]] = None  # 5 tin gần nhất


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
    product_confirmed: bool = False


class GenerateProductConfirmRequest(BaseModel):
    product_name: str


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
    if not body.message and not body.has_image:
        raise HTTPException(status_code=400, detail="message required")
    recent = [{"role": m.role, "content": m.content} for m in body.recent_messages] if body.recent_messages else None
    result = await classify_intent(body.message, body.has_image, body.current_state, recent)
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
        product_confirmed=body.product_confirmed,
    )

    # Lấy ảnh sản phẩm: ưu tiên image_results, fallback sang text search results
    product_images = []
    seen_urls = set()
    for r in (image_results + products_deduped):
        url = r.get("image_url") or r.get("payload", {}).get("image_url")
        if url and url not in seen_urls:
            product_images.append(url)
            seen_urls.add(url)
        if len(product_images) >= 2:
            break

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
# POST /chat/search-products
# Tìm SP trong Qdrant — không gọi LLM, chỉ vector search
# =============================================

class SearchProductsRequest(BaseModel):
    query: str
    user_id: str
    page_id: str
    top_k: int = 3


@router.post("/search-products")
async def api_search_products(body: SearchProductsRequest):
    results = []
    try:
        query_vec = await embedding_service.embed_query(body.query)
        results = await qdrant_service.search_similar_posts(
            query_vector=query_vec,
            user_id=body.user_id,
            top_k=body.top_k,
        )
    except Exception as e:
        logger.warning(f"[CHAT] search-products failed: {e}")

    product_images = []
    seen_urls: set = set()
    for r in results:
        url = r.get("image_url") or r.get("payload", {}).get("image_url")
        if url and url not in seen_urls:
            product_images.append(url)
            seen_urls.add(url)
        if len(product_images) >= 2:
            break

    top = results[0] if results else {}
    product_name = top.get("product_name") or top.get("payload", {}).get("product_name") or ""

    return {
        "found": len(results) > 0,
        "product_name": product_name,
        "products": results,
        "product_images": product_images,
    }


# =============================================
# POST /chat/generate-product-confirm
# =============================================

@router.post("/generate-product-confirm")
async def api_generate_product_confirm(body: GenerateProductConfirmRequest):
    reply = await generate_product_confirm(body.product_name)
    return {"reply": reply}


# =============================================
# POST /chat/generate-closing
# =============================================

class GenerateClosingRequest(BaseModel):
    product_name: str
    price: Optional[int] = None
    product_content: str = ""
    required_variants: list = []
    reply_style: Optional[str] = None


@router.post("/generate-closing")
async def api_generate_closing(body: GenerateClosingRequest):
    reply = await generate_closing_script(
        body.product_name,
        body.price,
        body.product_content,
        body.required_variants,
        body.reply_style,
    )
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
# POST /chat/extract-order-fields
# Trích xuất name/phone/address từ 1 tin nhắn
# =============================================

class ExtractOrderFieldsRequest(BaseModel):
    message: str


@router.post("/extract-order-fields")
async def api_extract_order_fields(body: ExtractOrderFieldsRequest):
    result = await extract_order_fields(body.message)
    return result


# =============================================
# POST /chat/consult
# State 2 — tư vấn + thu thập biến thể SP
# =============================================

class ConsultRequest(BaseModel):
    latest_message: str
    product_name: str
    product_content: str = ""
    niche: Optional[str] = None
    price: Optional[int] = None
    current_variants: dict = {}
    missing_variants: list = []
    is_complete: bool = False
    conversation_history: list = []
    reply_style: Optional[str] = None


@router.post("/consult")
async def api_consult(body: ConsultRequest):
    result = await consult_state2(
        latest_message=body.latest_message,
        product_name=body.product_name,
        product_content=body.product_content,
        niche=body.niche,
        price=body.price,
        current_variants=body.current_variants,
        missing_variants=body.missing_variants,
        is_complete=body.is_complete,
        conversation_history=body.conversation_history,
        reply_style=body.reply_style,
    )
    return result


# =============================================
# POST /chat/detect-variants
# Xác định biến thể cần hỏi cho sản phẩm
# =============================================

class DetectVariantsRequest(BaseModel):
    product_name: str
    product_content: str = ""
    niche: Optional[str] = None


@router.post("/detect-variants")
async def api_detect_variants(body: DetectVariantsRequest):
    variants = await detect_variants(body.product_name, body.product_content, body.niche)
    return {"required_variants": variants}


# =============================================
# POST /chat/consult-state3
# State 3 — thu thập thông tin giao hàng
# =============================================

class ConsultState3Request(BaseModel):
    latest_message: str
    product_name: str
    product_variants: dict = {}
    existing_profile: Optional[dict] = None
    missing_fields: list = []
    all_fields_valid: bool = False
    reply_style: Optional[str] = None


@router.post("/consult-state3")
async def api_consult_state3(body: ConsultState3Request):
    result = await consult_state3(
        latest_message=body.latest_message,
        product_name=body.product_name,
        product_variants=body.product_variants,
        existing_profile=body.existing_profile,
        missing_fields=body.missing_fields,
        all_fields_valid=body.all_fields_valid,
        reply_style=body.reply_style,
    )
    return result


# =============================================
# POST /chat/detect-niche
# Xác định ngách fanpage từ các bài đăng mẫu
# =============================================

class DetectNicheRequest(BaseModel):
    post_samples: list[str]


@router.post("/detect-niche")
async def api_detect_niche(body: DetectNicheRequest):
    niche = await detect_niche(body.post_samples)
    return {"niche": niche}


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


# =============================================
# POST /chat/rerank-products
# Stage 2: LLM chọn SP phù hợp nhất từ vector search candidates
# =============================================

class RerankCandidate(BaseModel):
    index: int
    product_name: str
    content: str = ""
    price: Optional[int] = None

class RerankRequest(BaseModel):
    query: str
    candidates: List[RerankCandidate]

@router.post("/rerank-products")
async def api_rerank_products(body: RerankRequest):
    result = await rerank_products(
        query=body.query,
        candidates=[c.dict() for c in body.candidates],
    )
    return result


class HandleSupportRequest(BaseModel):
    message: str
    product_hint: Optional[str] = None
    frustration_level: str = "low"
    reply_style: Optional[str] = None


class HandleGeneralRequest(BaseModel):
    message: str
    page_policy: Optional[str] = None
    niche: Optional[str] = None
    reply_style: Optional[str] = None


@router.post("/handle-support")
async def api_handle_support(body: HandleSupportRequest):
    return await handle_support(
        message=body.message,
        product_hint=body.product_hint,
        frustration_level=body.frustration_level,
        reply_style=body.reply_style,
    )


@router.post("/handle-general")
async def api_handle_general(body: HandleGeneralRequest):
    return await handle_general(
        message=body.message,
        page_policy=body.page_policy,
        niche=body.niche,
        reply_style=body.reply_style,
    )
