"""
LLM Service — trích xuất thông tin sản phẩm từ Facebook posts
Flow: text post → Groq (Llama 3.3 70B) → JSON kết quả
Ảnh KHÔNG gửi vào LLM — chỉ dùng để embedding ở bước sau
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

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Groq free: 30 RPM → 1 request/2s → delay 2.5s là an toàn
_SEM = asyncio.Semaphore(1)
_MIN_INTERVAL = 2.5
_last_call_time = 0.0


class LLMService:

    async def extract_post(self, post_text: str, image_urls: list[str] = None) -> dict:
        if not post_text or not post_text.strip():
            return {**_EMPTY_RESULT}

        payload = {
            "model": settings.groq_model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Nội dung bài đăng:\n{post_text[:4000]}"},
            ],
            "temperature": 0.1,
            "max_tokens": 300,
        }

        headers = {
            "Authorization": f"Bearer {settings.groq_api_key}",
            "Content-Type": "application/json",
        }

        for attempt in range(2):  # 1 retry
            try:
                async with _SEM:
                    global _last_call_time
                    loop = asyncio.get_event_loop()
                    now = loop.time()
                    wait = _MIN_INTERVAL - (now - _last_call_time)
                    if wait > 0:
                        await asyncio.sleep(wait)
                    _last_call_time = loop.time()

                    async with aiohttp.ClientSession() as session:
                        async with session.post(
                            _GROQ_URL,
                            json=payload,
                            headers=headers,
                            timeout=aiohttp.ClientTimeout(total=30),
                        ) as resp:
                            if resp.status == 429:
                                wait = 5 * (attempt + 1)
                                logger.warning(f"[LLM] 429 rate limit, retry sau {wait}s (attempt {attempt+1}/2)")
                                await asyncio.sleep(wait)
                                continue
                            if resp.status != 200:
                                text = await resp.text()
                                logger.error(f"[LLM] Groq lỗi {resp.status}: {text[:200]}")
                                return {**_EMPTY_RESULT}
                            data = await resp.json()

                raw = data["choices"][0]["message"]["content"].strip()
                logger.info(f"[LLM] Groq trả về: {raw[:300]}")

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

        logger.error("[LLM] Hết retry, bỏ qua post này")
        return {**_EMPTY_RESULT}

    async def extract_posts_batch(self, posts: list[dict]) -> list[dict]:
        results = []
        for post in posts:
            result = await self.extract_post(post_text=post.get("text", ""))
            results.append(result)
        return results


def _to_str_or_none(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return None if not s or s.lower() == "null" else s


def _to_int_or_none(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(float(str(val).replace(",", "").replace(".", "")))
    except (ValueError, TypeError):
        return None


llm_service = LLMService()
