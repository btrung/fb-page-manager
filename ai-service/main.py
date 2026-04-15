from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analyze
from app.config import settings
import uvicorn

app = FastAPI(
    title="FB Page AI Service",
    description="Phân tích và tạo vector embeddings cho Facebook posts",
    version="1.0.0",
)

# CORS — chỉ cho phép backend Node.js gọi
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(analyze.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
