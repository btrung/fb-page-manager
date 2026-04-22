"""
Chat LLM Service — phục vụ AI Chat feature
- Classify intent từ lịch sử hội thoại
- Generate reply ngắn dựa trên sản phẩm tìm được
- Generate probe message cho cold customer
- Generate confirmation summary khi chốt đơn
- Extract order info từ hội thoại
"""
import asyncio
import json
import logging
from typing import Optional

import aiohttp

from app.config import settings

logger = logging.getLogger(__name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Dùng chung semaphore với llm_service để tránh vượt rate limit Groq
# Groq free: 30 RPM → delay 2.5s giữa mỗi call
_SEM = asyncio.Semaphore(1)
_MIN_INTERVAL = 2.5
_last_call_time = 0.0


async def _call_groq(system_prompt: str, user_content: str, max_tokens: int = 300) -> Optional[str]:
    """Gọi Groq API, trả về text response hoặc None nếu lỗi."""
    global _last_call_time

    async with _SEM:
        # Rate limit: đảm bảo tối thiểu _MIN_INTERVAL giữa các call
        now = asyncio.get_event_loop().time()
        wait = _MIN_INTERVAL - (now - _last_call_time)
        if wait > 0:
            await asyncio.sleep(wait)

        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.post(
                    _GROQ_URL,
                    headers={
                        "Authorization": f"Bearer {settings.groq_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.groq_model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user",   "content": user_content},
                        ],
                        "max_tokens": max_tokens,
                        "temperature": 0.3,
                    },
                    timeout=aiohttp.ClientTimeout(total=15),
                )
                _last_call_time = asyncio.get_event_loop().time()

                if resp.status != 200:
                    text = await resp.text()
                    logger.error(f"[CHAT LLM] Groq error {resp.status}: {text[:200]}")
                    return None

                data = await resp.json()
                return data["choices"][0]["message"]["content"].strip()

        except Exception as e:
            logger.error(f"[CHAT LLM] Groq call failed: {e}")
            return None


# =============================================
# Intent Classifier
# =============================================

_INTENT_SYSTEM = """Bạn phân loại ý định mua hàng của khách qua tin nhắn Facebook.

Trả về JSON: {"intent": "...", "reason": "..."}

Các intent:
- "Muốn Mua": hỏi giá, đặt hàng, hỏi còn hàng, muốn mua
- "Đang Tư Vấn": hỏi thông tin SP, so sánh, hỏi chất lượng/mẫu mã
- "Đang Chốt": đã đồng ý mua, đang cung cấp tên/SĐT/địa chỉ
- "Khách Đùa": chào hỏi linh tinh, spam, không liên quan sản phẩm
- "Đã Xác Nhận": khách vừa xác nhận đồng ý sau tin AI tổng kết đơn hàng (ok/đúng rồi/xác nhận/được/đặt đi)

Chỉ trả về JSON thuần, không giải thích thêm."""


async def classify_intent(messages: list[dict]) -> dict:
    """
    Phân loại intent từ lịch sử hội thoại.
    messages: [{"role": "customer|ai|human", "content": "..."}]
    Trả về: {"intent": str, "reason": str}
    """
    history = "\n".join(
        f"[{m['role'].upper()}]: {m['content']}"
        for m in messages[-10:]  # chỉ lấy 10 tin cuối
        if m.get("content")
    )

    result = await _call_groq(_INTENT_SYSTEM, f"Lịch sử hội thoại:\n{history}", max_tokens=100)

    if not result:
        return {"intent": "Khách Đùa", "reason": "Không thể phân loại"}

    try:
        # Lấy JSON từ response (có thể có text thừa)
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        intent = parsed.get("intent", "Khách Đùa")
        valid = {"Muốn Mua", "Đang Tư Vấn", "Đang Chốt", "Khách Đùa", "Đã Xác Nhận"}
        if intent not in valid:
            intent = "Khách Đùa"
        return {"intent": intent, "reason": parsed.get("reason", "")}
    except Exception:
        return {"intent": "Khách Đùa", "reason": "Parse error"}


# =============================================
# Reply Generator
# =============================================

_REPLY_SYSTEM = """Bạn là nhân viên tư vấn bán hàng Facebook. Trả lời NGẮN GỌN (tối đa 3 câu).

Quy tắc:
- Giới thiệu sản phẩm với giá + khuyến mãi nếu có
- Kết thúc bằng 1 câu hook ngắn (hỏi có muốn đặt không, hoặc mời xem thêm)
- KHÔNG dài dòng, KHÔNG giải thích nhiều
- Xưng "em", gọi khách "anh/chị"
- Chỉ trả về nội dung tin nhắn, không thêm tiêu đề hay ghi chú"""


async def generate_reply(customer_message: str, products: list[dict]) -> str:
    """
    Tạo reply tư vấn dựa trên sản phẩm tìm được từ Qdrant.
    products: [{"product_name", "content", "price", "promotion", "image_url", "score"}]
    """
    if not products:
        return "Dạ em đang tìm sản phẩm phù hợp, anh/chị cho em hỏi thêm là đang cần sản phẩm gì ạ?"

    # Format top 1-2 sản phẩm
    product_context = ""
    for i, p in enumerate(products[:2], 1):
        name = p.get("product_name") or p.get("payload", {}).get("product_name", "Sản phẩm")
        price = p.get("price") or p.get("payload", {}).get("current_price")
        promotion = p.get("promotion") or p.get("payload", {}).get("what_is_promotion", "")
        content = p.get("content", "")[:200]

        price_str = f"{price:,}đ".replace(",", ".") if price else "liên hệ"
        product_context += f"SP{i}: {name} — Giá: {price_str}"
        if promotion:
            product_context += f" — KM: {promotion}"
        if content:
            product_context += f"\nMô tả: {content}"
        product_context += "\n"

    user_content = f"Tin nhắn khách: {customer_message}\n\nSản phẩm:\n{product_context}"
    result = await _call_groq(_REPLY_SYSTEM, user_content, max_tokens=200)
    return result or "Dạ em sẽ tư vấn ngay, anh/chị chờ em một chút nhé!"


# =============================================
# Probe Generator (khi Khách Đùa)
# =============================================

_PROBE_SYSTEM = """Bạn là nhân viên tư vấn bán hàng. Khách nhắn tin không rõ ý định.
Hỏi 1 câu ngắn để tìm hiểu họ đang cần gì. Tối đa 1 câu, thân thiện, xưng "em"."""


async def generate_probe(customer_message: str) -> str:
    """Tạo câu hỏi probe cho cold customer."""
    result = await _call_groq(_PROBE_SYSTEM, f"Tin nhắn khách: {customer_message}", max_tokens=80)
    return result or "Dạ anh/chị đang tìm sản phẩm gì vậy ạ? Em có thể hỗ trợ ngay ạ!"


# =============================================
# Confirmation Summary Generator
# =============================================

_CONFIRM_SYSTEM = """Bạn là nhân viên xác nhận đơn hàng. Tạo tin nhắn tổng kết đơn ngắn gọn.
Format:
Dạ em xác nhận lại đơn ạ:
📦 [Tên SP]
💰 [Giá]
👤 [Tên khách]
📞 [SĐT]
📍 [Địa chỉ]
Anh/chị xác nhận đặt nhé ạ? ✅

Chỉ trả về nội dung tin nhắn, không thêm gì khác."""


async def generate_confirmation(order_info: dict) -> str:
    """
    Tạo tin nhắn xác nhận đơn hàng để khách confirm.
    order_info: {product_name, price, customer_name, phone, address}
    """
    price = order_info.get("price")
    price_str = f"{price:,}đ".replace(",", ".") if price else "Liên hệ"

    content = (
        f"Sản phẩm: {order_info.get('product_name', '?')}\n"
        f"Giá: {price_str}\n"
        f"Tên: {order_info.get('customer_name', '?')}\n"
        f"SĐT: {order_info.get('phone', '?')}\n"
        f"Địa chỉ: {order_info.get('address', '?')}"
    )

    result = await _call_groq(_CONFIRM_SYSTEM, content, max_tokens=150)
    return result or (
        f"Dạ em xác nhận lại đơn ạ:\n"
        f"📦 {order_info.get('product_name', '?')}\n"
        f"💰 {price_str}\n"
        f"👤 {order_info.get('customer_name', '?')}\n"
        f"📞 {order_info.get('phone', '?')}\n"
        f"📍 {order_info.get('address', '?')}\n"
        f"Anh/chị xác nhận đặt nhé ạ? ✅"
    )


# =============================================
# Order Info Extractor
# =============================================

_EXTRACT_ORDER_SYSTEM = """Trích xuất thông tin đặt hàng từ hội thoại.
Trả về JSON: {"customer_name": null, "phone": null, "address": null, "complete": false}
- complete = true khi có đủ cả 3: customer_name, phone, address
- Chỉ trả về JSON thuần, không giải thích."""


async def extract_order_info(messages: list[dict]) -> dict:
    """
    Trích xuất tên, SĐT, địa chỉ từ lịch sử hội thoại.
    Trả về: {customer_name, phone, address, complete}
    """
    history = "\n".join(
        f"[{m['role'].upper()}]: {m['content']}"
        for m in messages[-15:]
        if m.get("content")
    )

    result = await _call_groq(_EXTRACT_ORDER_SYSTEM, f"Hội thoại:\n{history}", max_tokens=120)

    empty = {"customer_name": None, "phone": None, "address": None, "complete": False}
    if not result:
        return empty

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        name = parsed.get("customer_name")
        phone = parsed.get("phone")
        address = parsed.get("address")
        complete = bool(name and phone and address)
        return {"customer_name": name, "phone": phone, "address": address, "complete": complete}
    except Exception:
        return empty
