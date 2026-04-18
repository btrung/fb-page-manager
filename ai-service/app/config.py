from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Google Gemini — chỉ dùng cho embeddings
    gemini_api_key: str
    vision_model: str = "gemini-2.0-flash"
    embedding_model: str = "text-embedding-004"

    # Gemini — dùng cho cả LLM extraction lẫn embeddings
    llm_model: str = "gemini-2.0-flash"
    # Dimension của Gemini text embedding (khác OpenAI 1536d)
    embedding_dim: int = 768

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


settings = Settings()
