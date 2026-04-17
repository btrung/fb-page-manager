"""
Image Embedding Service — CLIP ViT-B/32 qua sentence-transformers
Nguyên tắc: ảnh chỉ tồn tại trong RAM vài giây
  Download → RAM (BytesIO) → Resize → CLIP encode → vector → xoá RAM
Không lưu file, không lưu ảnh vào DB.
"""
import asyncio
import io
import logging
from typing import Optional

import aiohttp
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Lazy load model để không block startup
_clip_model = None
_model_lock = asyncio.Lock()

# Giới hạn concurrent downloads để tránh OOM
_DOWNLOAD_SEMAPHORE = asyncio.Semaphore(8)


async def _get_clip_model():
    """
    Lazy load CLIP model lần đầu tiên được gọi.
    Thread-safe qua asyncio.Lock.
    """
    global _clip_model
    if _clip_model is not None:
        return _clip_model

    async with _model_lock:
        # Double-check sau khi acquire lock
        if _clip_model is not None:
            return _clip_model

        logger.info("[CLIP] Loading model clip-ViT-B/32 (lần đầu, ~1-2 phút)...")
        # Chạy trong thread pool để không block event loop
        loop = asyncio.get_event_loop()
        _clip_model = await loop.run_in_executor(None, _load_model_sync)
        logger.info("[CLIP] Model loaded ✅")

    return _clip_model


def _load_model_sync():
    """Đồng bộ load CLIP model (chạy trong thread pool)."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("clip-ViT-B-32")


class ImageEmbeddingService:
    """
    Service tạo CLIP embeddings cho ảnh.
    Mỗi ảnh xử lý trong RAM, không lưu disk.
    """

    async def _download_to_pil(
        self, url: str, session: aiohttp.ClientSession
    ) -> Optional[Image.Image]:
        """
        Download ảnh từ URL → PIL Image trong RAM.
        Trả về None nếu lỗi (timeout, không phải ảnh, v.v.)
        """
        async with _DOWNLOAD_SEMAPHORE:
            try:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    if resp.status != 200:
                        logger.warning(f"[IMG] HTTP {resp.status} cho {url}")
                        return None

                    content_type = resp.headers.get("Content-Type", "")
                    if "image" not in content_type:
                        logger.warning(f"[IMG] Không phải ảnh: {content_type} - {url}")
                        return None

                    raw = await resp.read()

                # Giải mã trong RAM
                buf = io.BytesIO(raw)
                img = Image.open(buf).convert("RGB")
                del raw, buf
                return img

            except asyncio.TimeoutError:
                logger.warning(f"[IMG] Timeout tải ảnh: {url}")
                return None
            except Exception as e:
                logger.warning(f"[IMG] Lỗi tải ảnh {url}: {e}")
                return None

    def _resize_in_ram(self, img: Image.Image, max_size: int = 256) -> Image.Image:
        """
        Resize giữ tỉ lệ, max_size px.
        256px đủ cho CLIP (model nội bộ resize về 224px).
        """
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        return img

    async def embed_image_url(self, url: str) -> Optional[list[float]]:
        """
        Tạo CLIP embedding từ 1 URL ảnh.
        Trả về list[float] 512d hoặc None nếu thất bại.
        Toàn bộ xử lý trong RAM, không lưu file.
        """
        model = await _get_clip_model()

        async with aiohttp.ClientSession() as session:
            img = await self._download_to_pil(url, session)

        if img is None:
            return None

        try:
            # Resize trong RAM
            img = self._resize_in_ram(img)

            # Encode trong thread pool (CPU-bound)
            loop = asyncio.get_event_loop()
            vector = await loop.run_in_executor(
                None, lambda: model.encode(img, convert_to_numpy=True)
            )

            # Normalize L2 để cosine similarity chính xác hơn
            norm = np.linalg.norm(vector)
            if norm > 0:
                vector = vector / norm

            result = vector.tolist()
            return result

        except Exception as e:
            logger.error(f"[CLIP] Encode thất bại cho {url}: {e}")
            return None
        finally:
            # Giải phóng RAM dù thành công hay thất bại
            del img

    async def embed_image_urls_batch(
        self, urls: list[str]
    ) -> list[Optional[list[float]]]:
        """
        Tạo CLIP embeddings cho nhiều URLs song song.
        Trả về list cùng index với input (None nếu URL thất bại).
        Batch download song song, encode tuần tự (CPU không parallel tốt).
        """
        model = await _get_clip_model()

        # Download tất cả song song
        async with aiohttp.ClientSession() as session:
            download_tasks = [self._download_to_pil(url, session) for url in urls]
            images = await asyncio.gather(*download_tasks)

        # Encode những ảnh download thành công
        results: list[Optional[list[float]]] = [None] * len(urls)
        valid_indices = [i for i, img in enumerate(images) if img is not None]

        if not valid_indices:
            return results

        try:
            valid_images = [self._resize_in_ram(images[i]) for i in valid_indices]

            # Encode batch trong thread pool
            loop = asyncio.get_event_loop()
            vectors = await loop.run_in_executor(
                None,
                lambda: model.encode(valid_images, convert_to_numpy=True, batch_size=16),
            )

            # Normalize và gán kết quả
            for idx, raw_vec in zip(valid_indices, vectors):
                norm = np.linalg.norm(raw_vec)
                vec = (raw_vec / norm if norm > 0 else raw_vec)
                results[idx] = vec.tolist()

        except Exception as e:
            logger.error(f"[CLIP] batch encode thất bại: {e}")
        finally:
            # Giải phóng tất cả ảnh trong RAM
            for img in images:
                if img is not None:
                    del img

        return results

    async def embed_pil_image(self, img: Image.Image) -> Optional[list[float]]:
        """
        Tạo embedding từ PIL Image đã có sẵn trong RAM.
        Dùng khi caller đã download ảnh rồi (vd: LLM service).
        """
        model = await _get_clip_model()
        try:
            img = self._resize_in_ram(img)
            loop = asyncio.get_event_loop()
            vector = await loop.run_in_executor(
                None, lambda: model.encode(img, convert_to_numpy=True)
            )
            norm = np.linalg.norm(vector)
            return (vector / norm if norm > 0 else vector).tolist()
        except Exception as e:
            logger.error(f"[CLIP] embed_pil_image thất bại: {e}")
            return None


# Singleton
image_embedding_service = ImageEmbeddingService()
