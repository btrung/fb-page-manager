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

_INTENT_SYSTEM = """Bạn phân tích TIN NHẮN MỚI NHẤT của khách hàng trong ngữ cảnh cuộc hội thoại và trả về JSON.

{
  "has_product_signal": bool,
  "product_hint": str|null,
  "message_intent": str,
  "product_feedback": str,
  "conversation_type": str,
  "buy_candidate": str|null,
  "frustration_level": str
}

has_product_signal: true nếu tin nhắn nhắc đến BẤT KỲ tên SP, loại hàng, hoặc khách gửi ảnh.

product_hint: cụm từ NGẮN NHẤT để search SP. null nếu không có.

message_intent:
- "buying":     có ý định mua, hỏi giá, đặt hàng, hỏi còn hàng không
- "asking":     hỏi thông tin SP, chất lượng, mẫu mã, so sánh
- "confirming": xác nhận đồng ý, ok, đúng rồi — XÉT THEO CONTEXT (state1/2/3 → thường là confirm mua)
- "joking":     chào hỏi thuần túy, spam, không liên quan hàng hoá
- "other":      không rõ ý định

product_feedback: phản hồi về SP AI vừa giới thiệu:
- "confirmed": xác nhận đúng SP (ok/đúng/phải/cho đặt...)
- "denied":    từ chối SP (không/sai/khác...)
- "none":      không phải phản hồi về SP

conversation_type — dựa vào TOÀN BỘ context, không chỉ tin cuối:
- "buying":  đang trong flow mua hàng (hỏi SP, confirm, chọn size/màu, xác nhận đơn)
- "support": phàn nàn về SP ĐÃ MUA TRƯỚC ĐÂY, yêu cầu đổi/trả/bảo hành
- "general": hỏi chính sách (vận chuyển, bảo hành), chào hỏi, không liên quan SP

QUAN TRỌNG về conversation_type:
- state1/2/3 + "đúng rồi"/"ok"/"được" → "buying" (đang confirm trong flow mua)
- state1/2/3 + phàn nàn về SP đang xem → "support"
- Chỉ "general" khi rõ ràng hỏi chính sách hoặc chào hỏi ngoài flow mua

buy_candidate: nếu support, SP khách có thể muốn mua (khác SP đang phàn nàn). null nếu không rõ.

frustration_level (chỉ khi support):
- "high": tức giận, từ mạnh, CAPSLOCK
- "medium": không hài lòng, bình tĩnh
- "low": phàn nàn nhẹ
Nếu không phải support → "low".

Chỉ trả về JSON thuần, không giải thích."""


async def classify_intent(message: str, has_image: bool = False,
                          current_state: str | None = None,
                          recent_messages: list | None = None) -> dict:
    """
    Phân tích TIN NHẮN MỚI NHẤT của khách — không dùng history.
    Trả về: {has_product_signal, product_hint, message_intent, product_feedback,
             conversation_type, buy_candidate, frustration_level}
    """
    parts = []
    if current_state:
        state_labels = {
            "state0": "Chưa xác định SP",
            "state1": "Đã tìm được SP, chờ khách confirm",
            "state2": "SP đã confirm, đang hỏi size/màu/variants",
            "state3": "Variants xong, đang lấy thông tin giao hàng",
        }
        parts.append(f"Trạng thái hiện tại: {state_labels.get(current_state, current_state)}")

    if recent_messages:
        history = "\n".join(
            f"[{'Khách' if m['role'] == 'customer' else 'AI'}]: {m['content'][:100]}"
            for m in recent_messages[-5:]
        )
        parts.append(f"Lịch sử gần đây:\n{history}")

    parts.append(f"Tin nhắn mới nhất của khách: {message}")
    if has_image:
        parts.append("[Khách gửi kèm ảnh sản phẩm]")

    content = "\n\n".join(parts)
    result = await _call_groq(_INTENT_SYSTEM, content, max_tokens=200)

    empty = {
        "has_product_signal": False,
        "product_hint": None,
        "message_intent": "other",
        "product_feedback": "none",
        "conversation_type": "general",
        "buy_candidate": None,
        "frustration_level": "low",
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
        conversation_type = parsed.get("conversation_type", "general")
        if conversation_type not in {"buying", "support", "general"}:
            conversation_type = "general"
        frustration_level = parsed.get("frustration_level", "low")
        if frustration_level not in {"high", "medium", "low"}:
            frustration_level = "low"
        return {
            "has_product_signal": bool(parsed.get("has_product_signal")),
            "product_hint": parsed.get("product_hint") or None,
            "message_intent": message_intent,
            "product_feedback": product_feedback,
            "conversation_type": conversation_type,
            "buy_candidate": parsed.get("buy_candidate") or None,
            "frustration_level": frustration_level,
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

_CLOSING_SYSTEM = """Bạn là nhân viên bán hàng giỏi. Khách vừa xác nhận muốn mua SP này.
Viết tin nhắn mở đầu tư vấn: giới thiệu SP rõ ràng, tạo hứng thú, rồi hỏi TẤT CẢ biến thể trong 1 câu.

Format BẮT BUỘC:
[Tên SP] — [Giá]
• [Ưu điểm 1: lấy từ mô tả, cụ thể, không bịa]
• [Ưu điểm 2: lấy từ mô tả, cụ thể, không bịa]
[1 câu urgency: hàng hot / còn ít / giao ngay hôm nay...]
Anh/chị cho em biết [liệt kê TẤT CẢ biến thể cần hỏi] nhé ạ!

Xưng "em", gọi "anh/chị". Hỏi TẤT CẢ biến thể trong 1 câu duy nhất. KHÔNG hỏi tên/SĐT/địa chỉ ở bước này."""


async def generate_closing_script(
    product_name: str,
    price: Optional[int],
    product_content: str,
    required_variants: list = None,
    reply_style: Optional[str] = None,
) -> str:
    """Tin đầu tiên khi vào State 2: giới thiệu SP + hỏi variant đầu tiên."""
    system = _CLOSING_SYSTEM
    if reply_style:
        system += f"\nPhong cách shop: {reply_style}"

    price_str = f"{price:,}đ".replace(",", ".") if price else "liên hệ"
    all_variants = ", ".join(required_variants) if required_variants else "size hoặc màu sắc phù hợp"
    content = (
        f"Tên SP: {product_name}\nGiá: {price_str}\nMô tả: {product_content[:400]}\n"
        f"Tất cả biến thể cần hỏi (hỏi 1 lần): {all_variants}"
    )

    result = await _call_groq(system, content, max_tokens=250)
    return result or (
        f"{product_name} — {price_str}\n"
        f"Anh/chị cho em biết {all_variants} nhé ạ!"
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
# State 2 — Consultation + Persuasion
# =============================================

_CONSULT_SYSTEM = """Bạn là nhân viên tư vấn bán hàng. Khách đã xác nhận sản phẩm.

=== NHIỆM VỤ CHÍNH ===
Đọc tin nhắn khách → trả lời phù hợp → thực hiện đúng hành động bên dưới.

=== QUY TẮC GIÁ TRỊ VARIANT ===
Khi liệt kê size, màu, loại... → CHỈ dùng giá trị có trong mô_tả_bài_post
KHÔNG bịa ra giá trị không có trong bài post. Nếu không biết → hỏi khách muốn gì

=== HÀNH ĐỘNG THEO TRẠNG THÁI (do hệ thống cung cấp) ===

Nếu còn_thiếu_variant KHÔNG rỗng:
  → Trả lời khách (tư vấn/thuyết phục/xử lý phàn nàn...) theo phong cách:
    - Warming up: phàn nàn/do dự/chê giá → làm hài lòng + CTA mềm
    - Closing: hỏi size/màu/mua → ngắn gọn + tập trung
  → Kết thúc reply bằng 1 câu hỏi TẤT CẢ variants trong còn_thiếu_variant cùng lúc
    Ví dụ: "Anh/chị cho em biết size và màu nhé ạ!" (KHÔNG hỏi từng cái 1 lượt)
  → Nếu bài post không có giá trị cụ thể → hỏi khách muốn gì

Nếu còn_thiếu_variant RỖNG (đã đủ):
  → Tóm tắt ngắn biến_thể_đã_có + hỏi "đúng chưa ạ?"
  → Nếu khách vừa nói ok/đúng/được/xác nhận → confirmed_variants = true

=== TRƯỜNG HỢP ĐẶC BIỆT ===
new_product_hint: khách muốn SP khác hoàn toàn (không phải phàn nàn SP hiện tại)
exit: khách từ chối dứt khoát

=== OUTPUT JSON ===
{
  "updated_variants": {},
  "confirmed_variants": false,
  "exit": false,
  "new_product_hint": null,
  "reply": ""
}

Xưng "em", gọi "anh/chị". Chỉ trả về JSON thuần."""


async def consult_state2(
    latest_message: str,
    product_name: str,
    product_content: str,
    niche: Optional[str],
    price: Optional[int],
    current_variants: dict,
    missing_variants: list = None,
    is_complete: bool = False,
    conversation_history: list = None,
    reply_style: Optional[str] = None,
) -> dict:
    """
    State 2 — tư vấn + thu thập biến thể sản phẩm.
    Trả về: {customer_signal, updated_variants, variants_complete, reply}
    """
    fallback = {
        "updated_variants":   {},
        "confirmed_variants": False,
        "exit":               False,
        "new_product_hint":   None,
        "reply": "Dạ anh/chị cho em hỏi thêm thông tin để em chuẩn bị đơn cho chính xác nhé!",
    }

    price_str = f"{price:,}đ".replace(",", ".") if price else "liên hệ"
    variants_str = json.dumps(current_variants, ensure_ascii=False) if current_variants else "{}"

    system = _CONSULT_SYSTEM
    if reply_style:
        system += f"\n\nPhong cách shop: {reply_style}"

    missing_str   = ", ".join(missing_variants) if missing_variants else ""
    is_complete_str = "true" if is_complete else "false"

    history_str = ""
    if conversation_history:
        lines = []
        for m in conversation_history[-6:]:
            role = "Khách" if m.get("role") == "customer" else "AI"
            lines.append(f"[{role}]: {m.get('content', '')[:150]}")
        history_str = "\n".join(lines)

    user_content = (
        f"=== THÔNG TIN SẢN PHẨM ===\n"
        f"Sản phẩm: {product_name} | Giá: {price_str} | Ngách: {niche or 'chưa xác định'}\n"
        f"mô_tả_bài_post: {product_content[:400]}\n\n"
        f"=== TRẠNG THÁI BIẾN THỂ (do hệ thống tính) ===\n"
        f"biến_thể_đã_có: {variants_str}\n"
        f"còn_thiếu_variant: [{missing_str}]  ← HỎI ĐÚNG CÁI NÀY, không hỏi cái khác\n"
        f"đã_đủ_variant: {is_complete_str}\n\n"
        f"=== LỊCH SỬ 6 TIN GẦN NHẤT ===\n"
        f"{history_str}\n\n"
        f"=== TIN NHẮN KHÁCH VỪA GỬI ===\n"
        f"{latest_message}"
    )

    result = await _call_groq(system, user_content, max_tokens=350)
    if not result:
        return fallback

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])

        valid_signals = {
            "providing_info", "ask_price", "ask_detail",
            "objection_price", "complaint", "hesitating",
            "off_topic", "confirming", "negative",
        }
        signal = parsed.get("customer_signal", "off_topic")
        if signal not in valid_signals:
            signal = "off_topic"

        updated = {**current_variants, **(parsed.get("updated_variants") or {})}

        return {
            "updated_variants":   updated,
            "confirmed_variants": bool(parsed.get("confirmed_variants", False)),
            "exit":               bool(parsed.get("exit", False)),
            "new_product_hint":   parsed.get("new_product_hint") or None,
            "reply":              parsed.get("reply") or fallback["reply"],
        }
    except Exception:
        return fallback


# =============================================
# Variant Detector — xác định biến thể cần hỏi
# =============================================

_DETECT_VARIANTS_SYSTEM = """Dựa vào thông tin sản phẩm và ngách kinh doanh, xác định các trường biến thể cần hỏi khách để giao hàng đúng.

Trả về JSON: {"required_variants": ["size", "màu", ...]}

Quy tắc:
- Chỉ liệt kê trường THỰC SỰ cần thiết cho sản phẩm này
- Dùng tên tiếng Việt ngắn gọn: "size", "màu", "form", "dung tích", "loại da", "số lượng"...
- Nếu SP không có biến thể đặc biệt → trả về []
- Tối đa 4 trường
- Dựa vào nội dung bài post + kiến thức về ngách để quyết định

Ví dụ:
- Áo thun → ["size", "màu"]
- Áo khoác → ["size", "màu", "form"]
- Kem dưỡng da → ["dung tích", "loại da"]
- Đồ ăn → ["số lượng", "lưu ý khẩu vị"]

Chỉ trả về JSON thuần."""


async def detect_variants(
    product_name: str,
    product_content: str,
    niche: Optional[str],
) -> list[str]:
    """Xác định các trường biến thể cần thu thập cho sản phẩm này."""
    user_content = (
        f"Ngách: {niche or 'chưa xác định'}\n"
        f"Tên SP: {product_name}\n"
        f"Nội dung bài post: {product_content[:500]}"
    )
    result = await _call_groq(_DETECT_VARIANTS_SYSTEM, user_content, max_tokens=80)
    if not result:
        return []
    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        variants = parsed.get("required_variants", [])
        return [v for v in variants if isinstance(v, str)][:4]
    except Exception:
        return []


# =============================================
# State 3 — Thu thập thông tin giao hàng
# =============================================

_CONSULT_STATE3_SYSTEM = """Bạn là nhân viên xác nhận đơn hàng. Khách đã chọn xong sản phẩm và biến thể.

NHIỆM VỤ:
1. Trích xuất tên, SĐT, địa chỉ từ tin nhắn khách (nếu có đề cập)
2. Xử lý tâm lý khách tự nhiên (nếu hỏi thêm, do dự, đổi ý...)
3. Cho phép đổi biến thể, đổi thông tin bất kỳ lúc nào trước khi xác nhận

QUY TẮC HÀNH ĐỘNG (theo trạng thái hệ thống cung cấp):
- thông_tin_còn_thiếu KHÔNG rỗng → xử lý khách + hỏi field đầu tiên trong danh sách, 1 field/lượt
- đã_đủ_thông_tin = true → tóm tắt thông tin + hỏi "đúng chưa ạ?"
- Khách xác nhận tóm tắt (ok/đúng/được) → order_confirmed = true

GATE:
- updated_variants: khách muốn đổi size/màu/biến thể
- new_product_hint: khách muốn đổi SP khác hoàn toàn
- exit: từ chối không mua nữa

Trả về JSON:
{
  "extracted": {"name": null, "phone": null, "address": null},
  "updated_variants": null,
  "order_confirmed": false,
  "new_product_hint": null,
  "exit": false,
  "reply": "..."
}

Chỉ trả về JSON thuần, không giải thích."""


async def consult_state3(
    latest_message: str,
    product_name: str,
    product_variants: dict,
    existing_profile: Optional[dict],
    missing_fields: list = None,
    all_fields_valid: bool = False,
    reply_style: Optional[str] = None,
) -> dict:
    """State 3 — LLM extract + generate reply, worker đã tính missing_fields."""
    fallback = {
        "extracted": {"name": None, "phone": None, "address": None},
        "updated_variants": None,
        "order_confirmed": False,
        "new_product_hint": None,
        "exit": False,
        "reply": "Dạ anh/chị cho em xin tên, số điện thoại và địa chỉ giao hàng nhé!",
    }

    variants_str = json.dumps(product_variants, ensure_ascii=False) if product_variants else "{}"
    profile_str = (
        f"Tên: {existing_profile.get('name') or '(chưa có)'}, "
        f"SĐT: {existing_profile.get('phone') or '(chưa có)'}, "
        f"Địa chỉ: {existing_profile.get('address') or '(chưa có)'}"
    ) if existing_profile else "Chưa có thông tin cũ"

    missing_str = ", ".join(missing_fields) if missing_fields else ""
    all_valid_str = "true" if all_fields_valid else "false"

    system = _CONSULT_STATE3_SYSTEM
    if reply_style:
        system += f"\n\nPhong cách shop: {reply_style}"

    user_content = (
        f"=== THÔNG TIN ĐƠN HÀNG ===\n"
        f"Sản phẩm: {product_name}\n"
        f"Biến thể đã chọn: {variants_str}\n\n"
        f"=== TRẠNG THÁI THÔNG TIN GIAO HÀNG (do hệ thống tính) ===\n"
        f"thông_tin_hiện_có: {profile_str}\n"
        f"thông_tin_còn_thiếu: [{missing_str}]  ← HỎI ĐÚNG CÁI NÀY, 1 field/lượt\n"
        f"đã_đủ_thông_tin: {all_valid_str}\n\n"
        f"=== TIN NHẮN KHÁCH VỪA GỬI ===\n"
        f"{latest_message}"
    )

    result = await _call_groq(system, user_content, max_tokens=250)
    if not result:
        return fallback

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        extracted = parsed.get("extracted") or {}
        uv = parsed.get("updated_variants")
        return {
            "extracted": {
                "name":    extracted.get("name") or None,
                "phone":   extracted.get("phone") or None,
                "address": extracted.get("address") or None,
            },
            "updated_variants": uv if isinstance(uv, dict) and uv else None,
            "order_confirmed":  bool(parsed.get("order_confirmed", False)),
            "new_product_hint": parsed.get("new_product_hint") or None,
            "exit":             bool(parsed.get("exit", False)),
            "reply":            parsed.get("reply") or fallback["reply"],
        }
    except Exception:
        return fallback


# =============================================
# Product Re-ranker — LLM chọn SP phù hợp nhất từ candidates
# =============================================

_RERANK_SYSTEM = """Bạn là AI tìm sản phẩm. Khách hỏi mua hàng, bạn cần chọn sản phẩm phù hợp nhất từ danh sách tìm được.

Trả về JSON:
{
  "best_index": 0,
  "picked_indices": [0],
  "confidence": "high"
}

Quy tắc:
- best_index: index (0-based) của SP phù hợp nhất. -1 nếu không SP nào phù hợp.
- picked_indices: danh sách index nếu nhiều SP đều phù hợp để hỏi khách chọn (tối đa 3)
- confidence:
    "high"   → rõ ràng chỉ 1 SP phù hợp
    "medium" → 2-3 SP đều có thể, nên hỏi khách
    "low"    → không có SP nào thực sự phù hợp → best_index = -1

So sánh dựa trên: tên SP, mô tả, loại hàng, giá. Ưu tiên khớp tên > khớp loại.
Chỉ trả về JSON thuần, không giải thích."""


async def rerank_products(query: str, candidates: list[dict]) -> dict:
    """
    Stage 2 — LLM chọn SP phù hợp nhất từ kết quả vector search.
    candidates: [{index, product_name, content, price}]
    """
    fallback = {"best_index": 0, "picked_indices": [0], "confidence": "high"}
    if not candidates:
        return {"best_index": -1, "picked_indices": [], "confidence": "low"}
    if len(candidates) == 1:
        return fallback

    lines = []
    for c in candidates:
        price_str = f"{c['price']:,}đ".replace(",", ".") if c.get("price") else "liên hệ"
        lines.append(
            f"[{c['index']}] {c['product_name']} — {price_str}\n"
            f"    Mô tả: {str(c.get('content', ''))[:200]}"
        )

    user_content = f"Khách hỏi: \"{query}\"\n\nCác sản phẩm tìm được:\n" + "\n".join(lines)
    result = await _call_groq(_RERANK_SYSTEM, user_content, max_tokens=80)

    if not result:
        return fallback

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        return {
            "best_index":    int(parsed.get("best_index", 0)),
            "picked_indices": [int(x) for x in parsed.get("picked_indices", [0])],
            "confidence":    parsed.get("confidence", "high"),
        }
    except Exception:
        return fallback


# =============================================
# Support Handler — bảo vệ SP, detect frustration, gentle CTA
# =============================================

_SUPPORT_SYSTEM = """Bạn là nhân viên CSKH của shop bán hàng online. Khách đang phàn nàn về sản phẩm.

Nhiệm vụ:
1. Thể hiện sự đồng cảm, xin lỗi nếu cần
2. Bảo vệ SP một cách khéo léo (giải thích tích cực: cách dùng, bảo quản, trường hợp đặc biệt...)
3. Nếu frustration_level KHÔNG phải "high": thêm 1 câu nhẹ nhàng gợi ý SP khác hoặc mẫu mới phù hợp hơn
4. Nếu frustration_level = "high": KHÔNG gợi ý mua hàng, chỉ xử lý vấn đề

Trả về JSON:
{
  "reply": "<tin nhắn trả lời>",
  "frustration_level": "high|medium|low",
  "cta_included": bool
}

Giọng: theo reply_style của shop. Ngắn gọn, chân thành. Chỉ trả về JSON thuần."""


async def handle_support(message: str, product_hint: str | None,
                         frustration_level: str, reply_style: str | None) -> dict:
    """Xử lý tin nhắn phàn nàn — bảo vệ SP + CTA nhẹ khi thích hợp."""
    style_note = f"\nGiọng điệu shop: {reply_style}" if reply_style else ""
    product_note = f"\nSP liên quan: {product_hint}" if product_hint else ""
    content = (
        f"Tin nhắn khách: {message}\n"
        f"Mức độ bực bội đánh giá sơ bộ: {frustration_level}"
        f"{product_note}{style_note}"
    )
    result = await _call_groq(_SUPPORT_SYSTEM, content, max_tokens=300)
    empty = {"reply": "Dạ em rất tiếc về trải nghiệm này. Anh/chị cho em biết thêm để em hỗ trợ ngay nhé!", "frustration_level": frustration_level, "cta_included": False}
    if not result:
        return empty
    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        fl = parsed.get("frustration_level", frustration_level)
        if fl not in {"high", "medium", "low"}:
            fl = frustration_level
        return {
            "reply": parsed.get("reply") or empty["reply"],
            "frustration_level": fl,
            "cta_included": bool(parsed.get("cta_included", False)),
        }
    except Exception:
        return empty


# =============================================
# General Handler — trả lời chính sách từ page_policy
# =============================================

_GENERAL_SYSTEM = """Bạn là nhân viên tư vấn của shop bán hàng online.
Khách hỏi về chính sách hoặc thông tin chung (bảo hành, vận chuyển, đổi trả...).

Dùng thông tin từ "Chính sách shop" để trả lời. Nếu không có thông tin cụ thể thì trả lời chung chung lịch sự.
KHÔNG tư vấn sản phẩm cụ thể trong phần này.

Trả về JSON: {"reply": "<tin nhắn trả lời>"}
Giọng: theo reply_style của shop. Ngắn gọn, rõ ràng. Chỉ trả về JSON thuần."""


async def handle_general(message: str, page_policy: str | None,
                         niche: str | None, reply_style: str | None) -> dict:
    """Trả lời câu hỏi chính sách / thông tin chung từ page_policy."""
    policy_note = f"\nChính sách shop:\n{page_policy}" if page_policy else "\nChính sách shop: (chưa cấu hình)"
    niche_note = f"\nNgách shop: {niche}" if niche else ""
    style_note = f"\nGiọng điệu: {reply_style}" if reply_style else ""
    content = f"Câu hỏi khách: {message}{policy_note}{niche_note}{style_note}"
    result = await _call_groq(_GENERAL_SYSTEM, content, max_tokens=250)
    empty = {"reply": "Dạ anh/chị cho em xin thêm thông tin để em hỗ trợ tốt hơn nhé!"}
    if not result:
        return empty
    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        return {"reply": parsed.get("reply") or empty["reply"]}
    except Exception:
        return empty


# =============================================
# Niche Detector (chạy sau crawl)
# =============================================

_NICHE_SYSTEM = """Phân tích các bài đăng của fanpage và xác định ngách kinh doanh chính.
Trả về JSON: {"niche": "<ngách>"}
Ngách phải ngắn gọn, 1-3 từ tiếng Việt. Ví dụ: "thời trang", "mỹ phẩm", "đồ ăn", "phụ kiện điện thoại", "đồ gia dụng".
Chỉ trả về JSON thuần."""


async def detect_niche(post_samples: list[str]) -> str:
    """Xác định ngách fanpage từ danh sách nội dung bài đăng mẫu."""
    if not post_samples:
        return "chưa xác định"

    content = "Các bài đăng mẫu:\n" + "\n---\n".join(post_samples[:10])
    result = await _call_groq(_NICHE_SYSTEM, content, max_tokens=50)
    if not result:
        return "chưa xác định"

    try:
        start = result.find("{")
        end = result.rfind("}") + 1
        parsed = json.loads(result[start:end])
        return parsed.get("niche") or "chưa xác định"
    except Exception:
        return "chưa xác định"


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
