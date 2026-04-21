"""
Embedding Service — paraphrase-multilingual-MiniLM-L12-v2
Local, 384d, multilingual (tiếng Việt tốt), ~200MB RAM
"""
import asyncio
import logging
from typing import Optional

from sentence_transformers import SentenceTransformer

from app.config import settings

logger = logging.getLogger(__name__)

_model: Optional[SentenceTransformer] = None
_model_lock = asyncio.Lock()


async def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        async with _model_lock:
            if _model is None:
                loop = asyncio.get_event_loop()
                _model = await loop.run_in_executor(
                    None,
                    lambda: SentenceTransformer(settings.embedding_model, device="cpu"),
                )
                logger.info(f"[EMBED] Text model loaded: {settings.embedding_model} ({settings.embedding_dim}d)")
    return _model


class EmbeddingService:
    def __init__(self):
        self.dim = settings.embedding_dim  # 384

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        model = await get_model()
        loop = asyncio.get_event_loop()

        def _encode():
            vecs = model.encode(texts, batch_size=32, show_progress_bar=False)
            return vecs.tolist()

        return await loop.run_in_executor(None, _encode)

    async def embed_query(self, query: str) -> list[float]:
        vectors = await self.embed_texts([query])
        return vectors[0]


embedding_service = EmbeddingService()
