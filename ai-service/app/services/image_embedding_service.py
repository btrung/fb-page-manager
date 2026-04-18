"""
Image Embedding Service — CLIP ViT-B/32
Download ảnh → RAM → CLIP encode → 512d vector → xoá RAM
Không lưu file, không gọi API ngoài.
"""
import asyncio
import io
import logging
from typing import Optional

import aiohttp
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_clip_model = None
_clip_lock = asyncio.Lock()
_DOWNLOAD_SEM = asyncio.Semaphore(8)


async def _get_clip():
    global _clip_model
    if _clip_model is not None:
        return _clip_model
    async with _clip_lock:
        if _clip_model is not None:
            return _clip_model
        logger.info("[CLIP] Loading clip-ViT-B-32 lần đầu...")
        from sentence_transformers import SentenceTransformer
        loop = asyncio.get_event_loop()
        _clip_model = await loop.run_in_executor(
            None, lambda: SentenceTransformer("clip-ViT-B-32")
        )
        logger.info("[CLIP] Ready ✅")
    return _clip_model


class ImageEmbeddingService:

    async def _download(self, url: str, session: aiohttp.ClientSession) -> Optional[Image.Image]:
        async with _DOWNLOAD_SEM:
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status != 200:
                        return None
                    if "image" not in resp.headers.get("Content-Type", ""):
                        return None
                    raw = await resp.read()
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                del raw
                return img
            except Exception as e:
                logger.warning(f"[CLIP] Lỗi tải ảnh {url[:60]}: {e}")
                return None

    async def embed_image_url(self, url: str) -> Optional[list[float]]:
        async with aiohttp.ClientSession() as session:
            img = await self._download(url, session)

        if img is None:
            return None

        try:
            model = await _get_clip()
            loop = asyncio.get_event_loop()
            vector = await loop.run_in_executor(
                None, lambda: model.encode(img, convert_to_numpy=True)
            )
            return vector.tolist()
        except Exception as e:
            logger.error(f"[CLIP] encode thất bại: {e}")
            return None
        finally:
            del img

    async def embed_image_urls_batch(self, urls: list[str]) -> list[Optional[list[float]]]:
        results = []
        for url in urls:
            vec = await self.embed_image_url(url)
            results.append(vec)
        return results

    async def embed_pil_image(self, img: Image.Image) -> Optional[list[float]]:
        try:
            model = await _get_clip()
            loop = asyncio.get_event_loop()
            vector = await loop.run_in_executor(
                None, lambda: model.encode(img, convert_to_numpy=True)
            )
            return vector.tolist()
        except Exception as e:
            logger.error(f"[CLIP] embed_pil_image thất bại: {e}")
            return None


image_embedding_service = ImageEmbeddingService()
