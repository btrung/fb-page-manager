from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analyze
from app.routers import extract
from app.config import settings
import uvicorn

app = FastAPI(
    title="FB Page AI Service",
    description="Product Intelligence — LLM extraction + CLIP embeddings",
    version="2.0.0",
)

# CORS — backend Node.js (api + worker) được phép gọi
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://backend:5000", "http://worker:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(analyze.router)
app.include_router(extract.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
