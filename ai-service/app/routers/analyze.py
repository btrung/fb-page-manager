from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.embedding_service import embedding_service
from app.services.vector_service import vector_service

router = APIRouter(prefix="/analyze", tags=["analyze"])


class PostItem(BaseModel):
    id: str
    message: str = ""
    picture: str | None = None
    created_time: str = ""


class AnalyzePostsRequest(BaseModel):
    page_id: str
    user_id: str
    posts: list[PostItem]


class SearchRequest(BaseModel):
    page_id: str
    user_id: str
    query: str
    top_k: int = 5


@router.post("/posts")
async def analyze_posts(body: AnalyzePostsRequest):
    if not body.posts:
        raise HTTPException(status_code=400, detail="No posts provided")

    posts_dict = [p.model_dump() for p in body.posts]

    try:
        embeddings = await embedding_service.embed_posts(posts_dict)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding failed: {str(e)}")

    post_ids = [p.id for p in body.posts]
    documents = [p.message or "(no text)" for p in body.posts]
    metadatas = [
        {
            "page_id": body.page_id,
            "user_id": body.user_id,
            "created_time": p.created_time,
            "has_image": bool(p.picture),
            "content": p.message or "(no text)",
        }
        for p in body.posts
    ]

    count = await vector_service.upsert_posts(
        user_id=body.user_id,
        page_id=body.page_id,
        post_ids=post_ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )

    return {
        "status": "success",
        "processed": count,
        "page_id": body.page_id,
        "message": f"Đã lưu {count} bài đăng vào vector database.",
    }


@router.post("/search")
async def search_posts(body: SearchRequest):
    try:
        query_embedding = await embedding_service.embed_query(body.query)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding failed: {str(e)}")

    results = await vector_service.search_similar(
        user_id=body.user_id,
        page_id=body.page_id,
        query_embedding=query_embedding,
        top_k=body.top_k,
    )

    return {"query": body.query, "results": results, "total": len(results)}


@router.get("/stats/{user_id}/{page_id}")
async def get_stats(user_id: str, page_id: str):
    count = await vector_service.get_collection_count(user_id, page_id)
    return {"user_id": user_id, "page_id": page_id, "indexed_posts": count}
