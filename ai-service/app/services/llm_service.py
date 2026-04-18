"""
LLM Service — trích xuất thông tin sản phẩm từ Facebook posts
Flow: ảnh → EasyOCR → text → ghép post text → Qwen (text only, OpenRouter)
"""
import asyncio
import json
import logging
from typing import Optional

import aiohttp

from app.config import settings

logger = logging.getLogger(__name__)

_EMPTY_RESULT = {
    "extracted_product_name": None,
    "price": None,
    "what_is_product": None,
    "product_count": 0,
    "is_sale_post": False,
    "what_is_promotion": None,
}

_SYSTEM_PROMPT = """Bạn là AI phân tích bài đăng Facebook bán hàng.
Nhiệm vụ: trích xuất thông tin sản phẩm từ nội dung bài đăng.

Trả về JSON với đúng các trường sau (không thêm trường khác):
{
  "extracted_product_name": "tên sản phẩm chính" hoặc null nếu không rõ,
  "price": số nguyên (VNĐ, không dấu chấm/phẩy) hoặc null nếu không có giá,
  "what_is_product": "mô tả ngắn sản phẩm là gì" hoặc null,
  "product_count": số lượng loại sản phẩm khác nhau trong bài (integer),
  "is_sale_post": true nếu đây là bài bán hàng/quảng cáo, false nếu không,
  "what_is_promotion": "mô tả khuyến mãi/ưu đãi nếu có" hoặc null
}

Quy tắc:
- is_sale_post = true: bài có rao bán, có giá, có CTA mua hàng, hoặc giới thiệu sản phẩm
- is_sale_post = false: bài chia sẻ, tin tức, cảm xúc, không liên quan bán hàng
- price: chỉ lấy số nguyên VNĐ. Ví dụ: "150k" → 150000, "1.200.000đ" → 1200000
- product_count: đếm số LOẠI sản phẩm khác nhau
- Chỉ trả về JSON thuần túy, không markdown, không giải thích"""

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_SEM = asyncio.Semaphore(3)


class LLMService:

    async def extract_post(
        self, post_text: str, image_urls: list[str] = None
    ) -> dict:
        if not post_text or not post_text.strip():
            return {**_EMPTY_RESULT}

        image_urls = image_urls or []
        logger.info(f"[LLM] post text={post_text[:150]!r} | images={image_urls}")

        # Bước 1: OCR ảnh → ghép vào text
        full_text = post_text
        if image_urls:
            from app.services.ocr_service import ocr_service
            ocr_text = await ocr_service.extract_from_urls(image_urls)
            if ocr_text:
                full_text = post_text + "\n[Text trong ảnh]: " + ocr_text
                logger.info(f"[OCR→LLM] OCR text: {ocr_text[:150]}")

        # Bước 2: Gửi full_text vào Qwen
        payload = {
            "model": settings.qwen_model,
            "messages": [
                {"role": "system", "content": "Bạn là AI trích xuất thông tin sản phẩm từ bài đăng Facebook. Chỉ trả về JSON."},
                {"role": "user", "content": f"{_SYSTEM_PROMPT}\n\nNội dung bài đăng:\n{full_text[:4000]}"},
            ],
            "temperature": 0.1,
            "max_tokens": 300,
        }

        headers = {
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }

        try:
            data = None
            async with _SEM:
                for attempt in range(4):
                    async with aiohttp.ClientSession() as session:
                        async with session.post(
                            _OPENROUTER_URL,
                            json=payload,
                            headers=headers,
                            timeout=aiohttp.ClientTimeout(total=30),
                        ) as resp:
                            if resp.status == 429:
                                wait = 2 ** attempt
                                logger.warning(f"[LLM] 429 rate limit, retry sau {wait}s (attempt {attempt+1}/4)")
                                await asyncio.sleep(wait)
                                continue
                            if resp.status != 200:
                                text = await resp.text()
                                logger.error(f"[LLM] OpenRouter lỗi {resp.status}: {text[:200]}")
                                return {**_EMPTY_RESULT}
                            data = await resp.json()
                            break
            if data is None:
                logger.error("[LLM] Hết retry, bỏ qua post này")
                return {**_EMPTY_RESULT}

            raw = data["choices"][0]["message"]["content"].strip()
            logger.info(f"[LLM] Qwen trả về: {raw[:300]}")

            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()

            parsed = json.loads(raw)
            return {
                "extracted_product_name": _to_str_or_none(parsed.get("extracted_product_name")),
                "price":                  _to_int_or_none(parsed.get("price")),
                "what_is_product":        _to_str_or_none(parsed.get("what_is_product")),
                "product_count":          max(0, int(parsed.get("product_count") or 0)),
                "is_sale_post":           bool(parsed.get("is_sale_post", False)),
                "what_is_promotion":      _to_str_or_none(parsed.get("what_is_promotion")),
            }

        except Exception as e:
            logger.error(f"[LLM] extract_post thất bại: {e}")
            return {**_EMPTY_RESULT}

    async def extract_posts_batch(self, posts: list[dict]) -> list[dict]:
        sem = asyncio.Semaphore(3)

        async def _safe(post: dict) -> dict:
            async with sem:
                return await self.extract_post(
                    post_text=post.get("text", ""),
                    image_urls=post.get("image_urls", []),
                )

        return await asyncio.gather(*[_safe(p) for p in posts])


def _to_str_or_none(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _to_int_or_none(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(float(str(val).replace(",", "").replace(".", "")))
    except (ValueError, TypeError):
        return None


llm_service = LLMService()
