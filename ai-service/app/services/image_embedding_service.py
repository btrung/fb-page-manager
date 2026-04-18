"""
Image Embedding Service — dùng Gemini Vision để mô tả ảnh,
sau đó embed text description bằng text-embedding-004 (768d).
Toàn bộ xử lý trong RAM, không lưu file.
"""
import asyncio
import io
import logging
from typing import Optional

import aiohttp
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

_DOWNLOAD_SEMAPHORE = asyncio.Semaphore(8)


class ImageEmbeddingService:

    async def _download_to_pil(
        self, url: str, session: aiohttp.ClientSession
    ) -> Optional[Image.Image]:
        async with _DOWNLOAD_SEMAPHORE:
            try:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    if resp.status != 200:
                        return None
                    content_type = resp.headers.get("Content-Type", "")
                    if "image" not in content_type:
                        return None
                    raw = await resp.read()
                buf = io.BytesIO(raw)
                img = Image.open(buf).convert("RGB")
                del raw, buf
                return img
            except Exception as e:
                logger.warning(f"[IMG] Lỗi tải ảnh {url}: {e}")
                return None

    async def _describe_image(self, img: Image.Image) -> Optional[str]:
        """Dùng Gemini Vision để mô tả ảnh sản phẩm ngắn gọn."""
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(settings.vision_model)

        loop = asyncio.get_event_loop()

        def _call():
            prompt = "Mô tả ngắn gọn sản phẩm trong ảnh này bằng tiếng Anh (tối đa 50 từ): tên sản phẩm, màu sắc, đặc điểm nổi bật."
            response = model.generate_content([prompt, img])
            return response.text.strip()

        try:
            return await loop.run_in_executor(None, _call)
        except Exception as e:
            logger.warning(f"[IMG] Gemini vision thất bại: {e}")
            return None

    async def _embed_text(self, text: str) -> Optional[list[float]]:
        """Embed text description bằng Gemini text-embedding-004."""
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)

        loop = asyncio.get_event_loop()

        def _call():
            result = genai.embed_content(
                model=settings.embedding_model,
                content=text,
                task_type="retrieval_document",
            )
            return result["embedding"]

        try:
            return await loop.run_in_executor(None, _call)
        except Exception as e:
            logger.error(f"[EMBED] text embed thất bại: {e}")
            return None

    async def embed_image_url(self, url: str) -> Optional[list[float]]:
        """Tạo 768d embedding từ URL ảnh qua Gemini Vision."""
        async with aiohttp.ClientSession() as session:
            img = await self._download_to_pil(url, session)

        if img is None:
            return None

        try:
            description = await self._describe_image(img)
            if not description:
                return None
            return await self._embed_text(description)
        finally:
            del img

    async def embed_image_urls_batch(
        self, urls: list[str]
    ) -> list[Optional[list[float]]]:
        """Tạo embeddings cho nhiều URLs, xử lý tuần tự để tránh rate limit."""
        results = []
        for url in urls:
            vec = await self.embed_image_url(url)
            results.append(vec)
            await asyncio.sleep(0.2)
        return results

    async def embed_pil_image(self, img: Image.Image) -> Optional[list[float]]:
        """Tạo embedding từ PIL Image đã có sẵn."""
        try:
            description = await self._describe_image(img)
            if not description:
                return None
            return await self._embed_text(description)
        except Exception as e:
            logger.error(f"[IMG] embed_pil_image thất bại: {e}")
            return None


image_embedding_service = ImageEmbeddingService()
