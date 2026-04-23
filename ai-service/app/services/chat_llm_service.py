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

_INTENT_SYSTEM = """Bạn phân tích TIN NHẮN MỚI NHẤT của khách hàng và trả về JSON.

{"has_product_signal": bool, "product_hint": str|null, "message_intent": str, "product_feedback": str}

has_product_signal: true nếu tin nhắn nhắc đến BẤT KỲ tên SP, loại hàng, hoặc khách gửi ảnh.
  false nếu chỉ chào hỏi, đùa giỡn, hỏi lung tung không liên quan hàng hoá.

product_hint: cụm từ NGẮN NHẤT để search SP ("áo thun lạnh", "túi da đen size M").
  null nếu không có tín hiệu SP nào.

message_intent:
- "buying":     có ý định mua, hỏi giá, đặt hàng, hỏi còn hàng không
- "asking":     hỏi thông tin SP, chất lượng, mẫu mã, so sánh
- "confirming": xác nhận đúng SP hoặc đồng ý mua (ok/phải/đúng rồi/cho em đặt/được/vâng...)
- "joking":     chào hỏi thuần túy, spam, câu hỏi không liên quan hàng hoá
- "other":      không rõ ý định

product_feedback: phản hồi của khách về SP AI vừa giới thiệu — chỉ xét tin nhắn này:
- "confirmed": xác nhận đúng SP (đúng/phải/ok/vâng/cho đặt...)
- "denied":    từ chối SP (không phải/sai/khác/không đúng/không giống...)
- "none":      không phải phản hồi về SP cụ thể nào

Chỉ trả về JSON thuần, không giải thích."""


async def classify_intent(message: str, has_image: bool = False) -> dict:
    """
    Phân tích TIN NHẮN MỚI NHẤT của khách — không dùng history.
    Trả về: {has_product_signal, product_hint, message_intent, product_feedback}
    """
    content = f"Tin nhắn: {message}"
    if has_image:
        content += "\n[Khách gửi kèm ảnh sản phẩm]"

    result = await _call_groq(_INTENT_SYSTEM, content, max_tokens=120)

    empty = {
        "has_product_signal": False,
        "product_hint": None,
        "message_intent": "other",
        "product_feedback": "none",
    }
    if not result:
        return empty

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        message_intent = parsed.get("message_intent", "other")
        if message_intent not in {"buying", "asking", "confirming", "joking", "other"}:
            message_intent = "other"
        product_feedback = parsed.get("product_feedback", "none")
        if product_feedback not in {"confirmed", "denied", "none"}:
            product_feedback = "none"
        return {
            "has_product_signal": bool(parsed.get("has_product_signal")),
            "product_hint": parsed.get("product_hint") or None,
            "message_intent": message_intent,
            "product_feedback": product_feedback,
        }
    except Exception:
        return empty


# =============================================
# Reply Generator
# =============================================

_REPLY_SYSTEM_BASE = """Bạn là nhân viên tư vấn bán hàng Facebook. Trả lời NGẮN GỌN (2-3 câu).

Quy tắc BẮT BUỘC:
1. Câu 1: báo giá + 1 điểm nổi bật/chất lượng của sản phẩm (lấy từ mô tả, không bịa)
2. Câu 2 (nếu có khuyến mãi): đề cập khuyến mãi
3. Câu cuối: 1 câu thuyết phục/tạo urgency — KHÔNG chỉ hỏi "anh muốn mua không?", phải có lý do hành động (ví dụ: "hàng đang hot", "giới hạn", "giao ngay hôm nay", "còn mấy cái cuối")

KHÔNG viết nhạt kiểu "anh muốn mua không?" — phải có sức thuyết phục.
Xưng "em", gọi khách "anh/chị" (nếu biết tên thì thêm tên).
Chỉ trả về nội dung tin nhắn, không thêm tiêu đề hay ghi chú."""

_REPLY_SYSTEM_CLOSING = """Bạn là nhân viên bán hàng giỏi. Khách đã xác nhận đúng sản phẩm và có ý định mua.
Viết tin nhắn tư vấn THUYẾT PHỤC để chốt đơn (3-4 câu):
1. Tên SP + giá rõ ràng
2. 2 điểm mạnh/công dụng nổi bật (lấy từ mô tả, có thể nhấn mạnh để hấp dẫn)
3. 1 câu tạo khan hiếm/urgency (hàng hot, bán chạy, còn ít, giao ngay hôm nay...)
4. 1 câu chốt trực tiếp: rủ đặt ngay, hoặc hỏi size/màu để xác nhận đơn

Xưng "em", gọi "anh/chị". KHÔNG được hỏi "anh/chị muốn mua không?" — phải chủ động chốt.
Chỉ trả về nội dung tin nhắn."""


async def generate_reply(
    customer_message: str,
    products: list[dict],
    mood: str = "neutral",
    reply_style: Optional[str] = None,
    customer_name: Optional[str] = None,
    identified_product: Optional[dict] = None,
    product_confirmed: bool = False,
) -> str:
    """
    Tạo reply tư vấn dựa trên sản phẩm tìm được từ Qdrant.
    products: [{"product_name", "content", "price", "promotion", "image_url", "score"}]
    """
    if not products:
        return "Dạ em đang tìm sản phẩm phù hợp, anh/chị cho em hỏi thêm là đang cần sản phẩm gì ạ?"

    # Build system prompt — dùng closing script khi product đã confirmed
    system = _REPLY_SYSTEM_CLOSING if product_confirmed else _REPLY_SYSTEM_BASE
    if reply_style:
        system += f"\n\nPhong cách trả lời theo yêu cầu shop: {reply_style}"
    if mood == "negative":
        system += "\nKhách đang có vẻ không hài lòng — hãy đặc biệt lịch sự và thông cảm."
    elif mood == "urgent":
        system += "\nKhách đang cần gấp — trả lời nhanh gọn, ưu tiên thông tin giá và đặt hàng."

    # Format top 1-2 sản phẩm
    product_context = ""
    for i, p in enumerate(products[:2], 1):
        payload = p.get("payload", p)  # search_similar_posts trả về flat dict (payload merged)
        name = payload.get("product_name", "Sản phẩm")
        price = payload.get("current_price") or payload.get("price")
        promotion = payload.get("what_is_promotion") or payload.get("promotion", "")
        content = payload.get("content", "")[:200]

        price_str = f"{price:,}đ".replace(",", ".") if price else "liên hệ"
        product_context += f"SP{i}: {name} — Giá: {price_str}"
        if promotion:
            product_context += f" — KM: {promotion}"
        if content:
            product_context += f"\nMô tả: {content}"
        product_context += "\n"

    user_content = f"Tin nhắn khách: {customer_message}\n"
    if customer_name:
        user_content += f"Tên khách: {customer_name}\n"
    if identified_product:
        user_content += f"Sản phẩm khách đang hỏi: {identified_product.get('name', '')}\n"
    user_content += f"\nSản phẩm tìm được:\n{product_context}"

    result = await _call_groq(system, user_content, max_tokens=200)
    return result or "Dạ em sẽ tư vấn ngay, anh/chị chờ em một chút nhé!"


# =============================================
# Probe Generator (khi Khách Đùa)
# =============================================

_PROBE_SYSTEM = """Bạn là nhân viên tư vấn bán hàng. Khách nhắn tin không liên quan sản phẩm hoặc nói chuyện lung tung.

KHÔNG được đùa theo, không trả lời nội dung off-topic của khách.
Chỉ được làm 1 việc: hỏi khách đang cần tìm sản phẩm gì.
Viết 1-2 câu lịch sự, nhẹ nhàng redirect về sản phẩm. Xưng "em", gọi "anh/chị".
Ví dụ tốt: "Dạ bên em chuyên tư vấn sản phẩm ạ, anh/chị đang cần tìm gì thì nhắn hoặc gửi ảnh để em hỗ trợ ngay nhé!"
Chỉ trả về nội dung tin nhắn, không thêm gì."""


async def generate_probe(customer_message: str) -> str:
    """Redirect khách đùa/off-topic về sản phẩm."""
    result = await _call_groq(_PROBE_SYSTEM, f"Tin nhắn khách: {customer_message}", max_tokens=100)
    return result or "Dạ bên em chuyên tư vấn sản phẩm ạ, anh/chị đang cần tìm gì thì nhắn hoặc gửi ảnh để em hỗ trợ ngay nhé!"


# =============================================
# Clarify Generator (khi không rõ sản phẩm)
# =============================================

_CLARIFY_SYSTEM = """Bạn là nhân viên tư vấn bán hàng. Khách đang hỏi nhưng chưa rõ SP cụ thể.
Viết 1-2 câu ngắn: hỏi có biết tên SP hoặc có ảnh không, nếu không thì offer gửi vài mẫu đang có.
Xưng "em", gọi "anh/chị". Tự nhiên, không cứng nhắc.
Ví dụ tốt: "Anh/chị có biết tên SP cụ thể hoặc có ảnh tham khảo không ạ? Không có thì để em gửi vài mẫu đang có cho anh/chị xem nhé!"
Chỉ trả về nội dung tin nhắn, không thêm gì."""


async def generate_clarify(customer_message: str, identified_product: Optional[dict] = None) -> str:
    """Hỏi rõ sản phẩm, offer gửi mẫu nếu khách chưa biết cụ thể."""
    context = f"Tin nhắn khách: {customer_message}"
    if identified_product:
        context += f"\nLoại SP đã nhận ra: {identified_product.get('name', '')}"
    result = await _call_groq(_CLARIFY_SYSTEM, context, max_tokens=100)
    return result or "Anh/chị có biết tên SP cụ thể hoặc có ảnh tham khảo không ạ? Không có thì để em gửi vài mẫu đang có cho anh/chị xem nhé!"


# =============================================
# Product Confirmation Generator
# =============================================

_PRODUCT_CONFIRM_SYSTEM = """Bạn vừa tìm được sản phẩm cho khách. Viết 1-2 câu ngắn:
- Giới thiệu tên SP
- Hỏi có phải SP khách đang tìm không
Xưng "em", tự nhiên, thân thiện. Chỉ trả về nội dung tin nhắn."""


async def generate_product_confirm(product_name: str) -> str:
    """Hỏi khách xác nhận đây có phải SP họ đang tìm không."""
    result = await _call_groq(_PRODUCT_CONFIRM_SYSTEM, f"Tên sản phẩm: {product_name}", max_tokens=80)
    return result or f"Dạ bên em có {product_name} ạ, có phải SP anh/chị đang tìm không ạ? 😊"


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
# Closing Script Generator
# =============================================

_CLOSING_SYSTEM = """Bạn là nhân viên bán hàng giỏi. Viết tin nhắn chốt đơn ngắn gọn, thuyết phục.

Format BẮT BUỘC (giữ nguyên cấu trúc, không thêm bớt section):
[Tên SP] — [Giá]
• [Ưu điểm 1: lấy từ mô tả, cụ thể, không bịa]
• [Ưu điểm 2: lấy từ mô tả, cụ thể, không bịa]
[1 câu urgency: hàng hot / còn ít / giao ngay hôm nay / KM sắp hết...]
Anh/chị cho em xin tên, SĐT và địa chỉ để em chốt đơn ngay nhé! 📦

Xưng "em", gọi "anh/chị". KHÔNG thêm gì ngoài format trên."""


async def generate_closing_script(
    product_name: str,
    price: Optional[int],
    product_content: str,
    reply_style: Optional[str] = None,
) -> str:
    """Tạo kịch bản chốt đơn: ảnh (gửi riêng) + text này."""
    system = _CLOSING_SYSTEM
    if reply_style:
        system += f"\nPhong cách shop: {reply_style}"

    price_str = f"{price:,}đ".replace(",", ".") if price else "liên hệ"
    content = f"Tên SP: {product_name}\nGiá: {price_str}\nMô tả: {product_content[:400]}"

    result = await _call_groq(system, content, max_tokens=200)
    return result or (
        f"{product_name} — {price_str}\n"
        f"Anh/chị cho em xin tên, SĐT và địa chỉ để em chốt đơn ngay nhé! 📦"
    )


# =============================================
# Single-message Order Fields Extractor
# =============================================

_EXTRACT_FIELDS_SYSTEM = """Trích xuất thông tin đặt hàng từ TIN NHẮN DUY NHẤT của khách.
Trả về JSON: {"name": null, "phone": null, "address": null}
- name: họ tên người nhận (bỏ qua "anh", "chị", "em" đứng một mình)
- phone: số điện thoại (giữ nguyên format khách viết)
- address: địa chỉ giao hàng đầy đủ
- Trường nào không tìm thấy → null
Chỉ trả về JSON thuần, không giải thích."""


async def extract_order_fields(message: str) -> dict:
    """Trích xuất name/phone/address từ 1 tin nhắn duy nhất."""
    empty = {"name": None, "phone": None, "address": None}
    if not message.strip():
        return empty

    result = await _call_groq(_EXTRACT_FIELDS_SYSTEM, f"Tin nhắn: {message}", max_tokens=100)
    if not result:
        return empty

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        return {
            "name":    parsed.get("name") or None,
            "phone":   parsed.get("phone") or None,
            "address": parsed.get("address") or None,
        }
    except Exception:
        return empty


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
