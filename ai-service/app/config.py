from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # paraphrase-multilingual-MiniLM-L12-v2 — text embeddings local (384d, nhẹ, multilingual)
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dim: int = 384

    # Groq — dùng cho LLM extraction (text only)
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Qdrant — vector database
    # Local: http://localhost:6333  (không cần api_key)
    # Cloud: https://xxx.qdrant.io:6333  (cần api_key)
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""          # để trống nếu dùng local
    qdrant_collection_posts: str = "post_embeddings"
    qdrant_collection_images: str = "product_images"

    # Server
    port: int = 8000
    host: str = "0.0.0.0"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
