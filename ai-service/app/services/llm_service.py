"""
LLM Service — trích xuất thông tin sản phẩm từ Facebook posts
Dùng GPT-4o-mini với vision để xử lý cả text lẫn ảnh
Ảnh chỉ tồn tại trong RAM → base64 → gửi LLM → xoá ngay
"""
import asyncio
import base64
import io
import logging
from typing import Optional

import aiohttp
from openai import AsyncOpenAI
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

# Kết quả mặc định khi không thể trích xuất
_EMPTY_RESULT = {
    "extracted_product_name": None,
    "price": None,
    "what_is_product": None,
    "product_count": 0,
    "is_sale_post": False,
    "what_is_promotion": None,
}

# Prompt hướng dẫn LLM trích xuất đúng format
_SYSTEM_PROMPT = """Bạn là AI phân tích bài đăng Facebook bán hàng.
Nhiệm vụ: trích xuất thông tin sản phẩm từ nội dung bài đăng.

Trả về JSON với đúng các trường sau (không thêm trường khác):
{
  "extracted_product_name": "tên sản phẩm chính" hoặc null nếu không rõ,
  "price": số nguyên (VNĐ, không có dấu chấm/phẩy) hoặc null nếu không có giá,
  "what_is_product": "mô tả ngắn sản phẩm là gì" hoặc null,
  "product_count": số lượng loại sản phẩm khác nhau trong bài (integer),
  "is_sale_post": true nếu đây là bài bán hàng/quảng cáo sản phẩm, false nếu không,
  "what_is_promotion": "mô tả khuyến mãi/ưu đãi nếu có" hoặc null
}

Quy tắc:
- is_sale_post = true: bài có rao bán, có giá, có CTA mua hàng, hoặc giới thiệu sản phẩm
- is_sale_post = false: bài chia sẻ, tin tức, cảm xúc, không liên quan bán hàng
- price: chỉ lấy số nguyên VNĐ, bỏ qua "đ", ",", ".", "k" (k = 1000)
- Ví dụ: "150k" → 150000, "1.200.000đ" → 1200000
- product_count: đếm số LOẠI sản phẩm khác nhau, không phải số lượng tồn kho
"""


class LLMService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.vision_model
        # Giới hạn concurrency khi download ảnh
        self._semaphore = asyncio.Semaphore(5)

    async def _download_image_base64(
        self, url: str, session: aiohttp.ClientSession
    ) -> Optional[str]:
        """
        Download ảnh → RAM (BytesIO) → resize → base64
        Không lưu file, xoá RAM ngay sau khi encode
        """
        async with self._semaphore:
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        return None
                    content_type = resp.headers.get("Content-Type", "")
                    if "image" not in content_type:
                        return None

                    # Đọc vào RAM
                    raw_bytes = await resp.read()

                # Resize trong RAM để giảm token cost
                img_buf = io.BytesIO(raw_bytes)
                with Image.open(img_buf) as img:
                    # Chuyển sang RGB (xử lý ảnh PNG có alpha)
                    img = img.convert("RGB")
                    # Resize giữ tỉ lệ, max 512px
                    img.thumbnail((512, 512), Image.LANCZOS)
                    out_buf = io.BytesIO()
                    img.save(out_buf, format="JPEG", quality=85)
                    b64 = base64.b64encode(out_buf.getvalue()).decode("utf-8")

                # Giải phóng RAM
                del raw_bytes, img_buf, out_buf
                return b64

            except Exception as e:
                logger.warning(f"[LLM] Không tải được ảnh {url}: {e}")
                return None

    async def _build_messages(
        self, post_text: str, image_urls: list[str]
    ) -> list[dict]:
        """
        Tạo messages cho LLM:
        - Nếu có ảnh: dùng vision (gpt-4o-mini)
        - Nếu chỉ text: gửi text thuần
        Ảnh tải song song, tối đa 5 ảnh đầu tiên
        """
        content: list = [{"type": "text", "text": f"Nội dung bài đăng:\n{post_text[:3000]}"}]

        # Tối đa 3 ảnh để tiết kiệm token (filter >5 ảnh đã làm ở worker)
        urls_to_process = image_urls[:3]

        if urls_to_process:
            async with aiohttp.ClientSession() as session:
                tasks = [self._download_image_base64(url, session) for url in urls_to_process]
                results = await asyncio.gather(*tasks)

            for b64 in results:
                if b64:
                    content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}",
                            "detail": "low",  # low = 85 token/ảnh, đủ cho text extraction
                        },
                    })

        return [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ]

    async def extract_post(
        self, post_text: str, image_urls: list[str] = None
    ) -> dict:
        """
        Trích xuất thông tin sản phẩm từ 1 post
        Trả về dict với 6 fields (luôn trả về, không raise exception)
        """
        if not post_text or not post_text.strip():
            return {**_EMPTY_RESULT}

        image_urls = image_urls or []

        try:
            messages = await self._build_messages(post_text, image_urls)

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                max_tokens=300,
                temperature=0.1,  # Thấp để output ổn định
            )

            raw = response.choices[0].message.content
            import json
            data = json.loads(raw)

            # Validate và normalize từng field
            return {
                "extracted_product_name": _to_str_or_none(data.get("extracted_product_name")),
                "price": _to_int_or_none(data.get("price")),
                "what_is_product": _to_str_or_none(data.get("what_is_product")),
                "product_count": max(0, int(data.get("product_count") or 0)),
                "is_sale_post": bool(data.get("is_sale_post", False)),
                "what_is_promotion": _to_str_or_none(data.get("what_is_promotion")),
            }

        except Exception as e:
            logger.error(f"[LLM] extract_post thất bại: {e}")
            return {**_EMPTY_RESULT}

    async def extract_posts_batch(
        self, posts: list[dict]
    ) -> list[dict]:
        """
        Xử lý nhiều posts song song (tối đa 10 concurrent)
        Mỗi post: { text, image_urls }
        """
        sem = asyncio.Semaphore(10)

        async def _safe_extract(post: dict) -> dict:
            async with sem:
                return await self.extract_post(
                    post_text=post.get("text", ""),
                    image_urls=post.get("image_urls", []),
                )

        return await asyncio.gather(*[_safe_extract(p) for p in posts])


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
        return int(val)
    except (ValueError, TypeError):
        return None


# Singleton
llm_service = LLMService()
