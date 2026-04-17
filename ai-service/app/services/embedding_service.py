"""
Embedding Service — Google Gemini text-embedding-004
Thay thế OpenAI text-embedding-3-small
Output: 768 dimensions (Gemini) vs 1536 (OpenAI)
Free tier: 1500 requests/ngày
"""
import asyncio
import logging
from typing import Optional

import google.generativeai as genai

from app.config import settings

logger = logging.getLogger(__name__)

# Cấu hình Gemini (dùng chung key với llm_service)
genai.configure(api_key=settings.gemini_api_key)

# Semaphore tránh vượt rate limit (Gemini free: 1500 req/ngày, ~1 req/giây)
_EMBED_SEMAPHORE = asyncio.Semaphore(5)


class EmbeddingService:
    def __init__(self):
        self.model = settings.embedding_model  # "models/text-embedding-004"
        self.dim   = settings.embedding_dim    # 768

    def _build_post_text(self, post: dict) -> str:
        """Tạo text đại diện cho 1 post để embed."""
        parts = []
        if post.get("message"):
            parts.append(post["message"])
        if post.get("created_time"):
            parts.append(f"Ngày đăng: {post['created_time']}")
        return "\n".join(parts) if parts else "(Bài đăng không có nội dung text)"

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Embed nhiều texts song song với Gemini.
        task_type='retrieval_document' tối ưu cho lưu trữ/tìm kiếm.
        """
        async def _embed_one(text: str) -> list[float]:
            async with _EMBED_SEMAPHORE:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: genai.embed_content(
                        model=self.model,
                        content=text[:8000],  # Gemini limit ~2048 tokens
                        task_type="retrieval_document",
                    )
                )
                return result["embedding"]

        return await asyncio.gather(*[_embed_one(t) for t in texts])

    async def embed_posts(self, posts: list[dict]) -> list[list[float]]:
        """Embed danh sách posts từ Facebook."""
        texts = [self._build_post_text(p) for p in posts]
        return await self.embed_texts(texts)

    async def embed_query(self, query: str) -> list[float]:
        """
        Embed 1 câu query để search.
        task_type='retrieval_query' tối ưu cho query (khác document).
        """
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: genai.embed_content(
                model=self.model,
                content=query[:8000],
                task_type="retrieval_query",
            )
        )
        return result["embedding"]


embedding_service = EmbeddingService()
