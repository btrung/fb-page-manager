"""
Embedding Service — OpenAI text-embedding-3-small
Embed text từ Facebook posts (message + metadata)
"""
import httpx
from openai import AsyncOpenAI
from app.config import settings


class EmbeddingService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model

    def _build_post_text(self, post: dict) -> str:
        """
        Tạo text đại diện cho 1 post để embed
        Kết hợp: nội dung + context meta
        """
        parts = []
        if post.get("message"):
            parts.append(post["message"])
        if post.get("created_time"):
            parts.append(f"Ngày đăng: {post['created_time']}")
        return "\n".join(parts) if parts else "(Bài đăng không có nội dung text)"

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed nhiều texts cùng lúc (batch)"""
        # Giới hạn độ dài text (OpenAI max ~8191 tokens)
        truncated = [t[:6000] for t in texts]

        response = await self.client.embeddings.create(
            model=self.model,
            input=truncated,
        )
        return [item.embedding for item in response.data]

    async def embed_posts(self, posts: list[dict]) -> list[list[float]]:
        """Embed danh sách posts từ Facebook"""
        texts = [self._build_post_text(p) for p in posts]
        return await self.embed_texts(texts)

    async def embed_query(self, query: str) -> list[float]:
        """Embed 1 câu query để search"""
        embeddings = await self.embed_texts([query])
        return embeddings[0]


embedding_service = EmbeddingService()
