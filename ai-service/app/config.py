from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Google Gemini — thay thế OpenAI, có free tier
    gemini_api_key: str
    # gemini-1.5-flash: free 15 RPM, hỗ trợ vision
    vision_model: str = "gemini-1.5-flash"
    # text-embedding-004: free, 768d
    embedding_model: str = "models/text-embedding-004"
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
