"""
Embedding Service — Google Gemini text-embedding-004
Output: 768 dimensions
"""
import asyncio
import logging
from typing import Optional

from google import genai
from google.genai.types import EmbedContentConfig

from app.config import settings

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.gemini_api_key)
_EMBED_SEMAPHORE = asyncio.Semaphore(5)


class EmbeddingService:
    def __init__(self):
        self.model = settings.embedding_model  # "text-embedding-004"
        self.dim   = settings.embedding_dim    # 768

    def _build_post_text(self, post: dict) -> str:
        parts = []
        if post.get("message"):
            parts.append(post["message"])
        if post.get("created_time"):
            parts.append(f"Ngày đăng: {post['created_time']}")
        return "\n".join(parts) if parts else "(Bài đăng không có nội dung text)"

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        async def _embed_one(text: str) -> list[float]:
            async with _EMBED_SEMAPHORE:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: _client.models.embed_content(
                        model=self.model,
                        contents=text[:8000],
                        config=EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
                    )
                )
                return result.embeddings[0].values

        return await asyncio.gather(*[_embed_one(t) for t in texts])

    async def embed_posts(self, posts: list[dict]) -> list[list[float]]:
        texts = [self._build_post_text(p) for p in posts]
        return await self.embed_texts(texts)

    async def embed_query(self, query: str) -> list[float]:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: _client.models.embed_content(
                model=self.model,
                contents=query[:8000],
                config=EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
            )
        )
        return result.embeddings[0].values


embedding_service = EmbeddingService()
