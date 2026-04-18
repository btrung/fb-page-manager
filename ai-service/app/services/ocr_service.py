"""
OCR Service — EasyOCR extract text từ ảnh sản phẩm
Chạy CPU, hỗ trợ tiếng Việt + tiếng Anh
Model download lần đầu ~1GB, cached sau đó
"""
import asyncio
import io
import logging

import aiohttp
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_reader = None
_reader_lock = asyncio.Lock()


async def _get_reader():
    global _reader
    if _reader is not None:
        return _reader
    async with _reader_lock:
        if _reader is not None:
            return _reader
        logger.info("[OCR] Loading EasyOCR model lần đầu (~1-2 phút)...")
        import easyocr
        loop = asyncio.get_event_loop()
        _reader = await loop.run_in_executor(
            None, lambda: easyocr.Reader(['vi', 'en'], gpu=False, verbose=False)
        )
        logger.info("[OCR] EasyOCR ready ✅")
    return _reader


class OCRService:

    async def extract_from_url(self, url: str, session: aiohttp.ClientSession) -> str:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return ""
                if "image" not in resp.headers.get("Content-Type", ""):
                    return ""
                raw = await resp.read()

            img = Image.open(io.BytesIO(raw)).convert("RGB")
            img_np = np.array(img)
            del raw

            reader = await _get_reader()
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None, lambda: reader.readtext(img_np, detail=0, paragraph=True)
            )
            return " ".join(results).strip()

        except Exception as e:
            logger.warning(f"[OCR] Lỗi {url[:60]}: {e}")
            return ""

    async def extract_from_urls(self, urls: list[str]) -> str:
        """Extract text từ tối đa 3 ảnh, ghép lại."""
        if not urls:
            return ""
        texts = []
        async with aiohttp.ClientSession() as session:
            for url in urls[:3]:
                text = await self.extract_from_url(url, session)
                if text:
                    texts.append(text)
                    logger.info(f"[OCR] URL={url[:60]} → {text[:80]}")
        return "\n".join(texts)


ocr_service = OCRService()
