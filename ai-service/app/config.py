from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # OpenAI — text embeddings + vision LLM
    openai_api_key: str
    embedding_model: str = "text-embedding-3-small"
    vision_model: str = "gpt-4o-mini"

    # Qdrant — vector database
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection_posts: str = "post_embeddings"
    qdrant_collection_images: str = "product_images"

    # Server
    port: int = 8000
    host: str = "0.0.0.0"

    class Config:
        env_file = ".env"


settings = Settings()
