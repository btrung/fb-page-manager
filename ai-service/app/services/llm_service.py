"""
LLM Service — trích xuất thông tin sản phẩm từ Facebook posts
Dùng Google Gemini 1.5 Flash (free tier) với vision để xử lý text + ảnh
Ảnh chỉ tồn tại trong RAM → PIL Image → Gemini → xoá ngay
"""
import asyncio
import io
import json
import logging
from typing import Optional

import aiohttp
import google.generativeai as genai
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

# Cấu hình Gemini API key
genai.configure(api_key=settings.gemini_api_key)

# Kết quả mặc định khi không thể trích xuất
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

# Giới hạn concurrent downloads ảnh
_DOWNLOAD_SEMAPHORE = asyncio.Semaphore(5)


class LLMService:
    def __init__(self):
        self.model = genai.GenerativeModel(
            model_name=settings.vision_model,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=300,
            ),
        )

    async def _download_pil_image(
        self, url: str, session: aiohttp.ClientSession
    ) -> Optional[Image.Image]:
        """
        Download ảnh → PIL Image trong RAM.
        Resize 512px để giảm token. Trả về None nếu lỗi.
        """
        async with _DOWNLOAD_SEMAPHORE:
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        return None
                    if "image" not in resp.headers.get("Content-Type", ""):
                        return None
                    raw = await resp.read()

                buf = io.BytesIO(raw)
                img = Image.open(buf).convert("RGB")
                img.thumbnail((512, 512), Image.LANCZOS)
                del raw, buf
                return img

            except Exception as e:
                logger.warning(f"[LLM] Không tải được ảnh {url[:60]}: {e}")
                return None

    async def extract_post(
        self, post_text: str, image_urls: list[str] = None
    ) -> dict:
        """
        Trích xuất thông tin sản phẩm từ 1 post.
        Luôn trả về dict với 6 fields, không raise exception.
        """
        if not post_text or not post_text.strip():
            return {**_EMPTY_RESULT}

        image_urls = (image_urls or [])[:3]  # Tối đa 3 ảnh

        try:
            # Xây dựng content parts cho Gemini
            parts = [
                f"{_SYSTEM_PROMPT}\n\nNội dung bài đăng:\n{post_text[:3000]}"
            ]

            # Download ảnh song song rồi đưa PIL Image vào prompt
            if image_urls:
                async with aiohttp.ClientSession() as session:
                    tasks = [self._download_pil_image(url, session) for url in image_urls]
                    images = await asyncio.gather(*tasks)

                for img in images:
                    if img is not None:
                        parts.append(img)

            # Gọi Gemini (chạy trong thread pool để không block event loop)
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, lambda: self.model.generate_content(parts)
            )

            # Giải phóng ảnh trong RAM
            for p in parts:
                if isinstance(p, Image.Image):
                    del p

            raw = response.text.strip()
            # Bỏ markdown code block nếu model trả về ```json ... ```
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()

            data = json.loads(raw)
            return {
                "extracted_product_name": _to_str_or_none(data.get("extracted_product_name")),
                "price":                  _to_int_or_none(data.get("price")),
                "what_is_product":        _to_str_or_none(data.get("what_is_product")),
                "product_count":          max(0, int(data.get("product_count") or 0)),
                "is_sale_post":           bool(data.get("is_sale_post", False)),
                "what_is_promotion":      _to_str_or_none(data.get("what_is_promotion")),
            }

        except Exception as e:
            logger.error(f"[LLM] extract_post thất bại: {e}")
            return {**_EMPTY_RESULT}

    async def extract_posts_batch(self, posts: list[dict]) -> list[dict]:
        """
        Xử lý nhiều posts song song.
        Gemini free tier: 15 RPM → semaphore giới hạn 10 concurrent.
        """
        sem = asyncio.Semaphore(10)

        async def _safe(post: dict) -> dict:
            async with sem:
                return await self.extract_post(
                    post_text=post.get("text", ""),
                    image_urls=post.get("image_urls", []),
                )

        return await asyncio.gather(*[_safe(p) for p in posts])


# =============================================
# Helpers
# =============================================

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
