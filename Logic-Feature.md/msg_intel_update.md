
khi update post + image -> xác định ngách (thời trang, mỹ phẩm, đồ ăn...) và update vào 1 db rồi. 

mỗi câu hỏi về sp, có bước lọc này trước -> nếu có sp trong db này thì mới tư vấn
-> hỏi bên em không có bán dạng sp này




xác định ngách page (thời trang, mỹ phẩm,...) -> nghĩ cách lúc crawl post fanpage xong là xác định được các ngách của page này


tin nhắn đầu tiên

1. bộ lọc bảo vệ trước (quá 5 tin -> DỪNG)


hỏi khách cần tư vấn sản phẩm nào, có tên/ảnh để mình tư vấn


-> hỏi về sp đúng ngách -> mới qua giai đoạn tìm sp mục tiêu


2. giai đoạn tìm sp mục tiêu

- tìm đúng sp từ tên/ảnh mà khách cần (sẽ query qdrant + db để trả ảnh + content sản phẩm cho khách xem đúng k)
- khoá sp




3. giai đoạn tư vấn (chi tiết thông tin sp -> thuyết phục khách sp này tốt với họ)

dùng llm -> để hỏi đúng những trường biến thể sản phẩm quan trọng để gửi hàng cho đúng
vì thời trang sẽ có -> mẫu nào, size nào, nam/nữ, thông tin khách hàng
và mỹ phẩm -> dung tích, loại gì, thông tin khách hàng


- thuyết phục khách thích sp này (quan trọng)
luôn chủ động, nếu khách hỏi thì trả lời kiểu ưu điểm thuyết phục khách mua hàng + chủ động hỏi tấn công để chốt đơn hàng sớm


Ví Dụ LOGIC:

1. Nếu khách hỏi (ask_price / ask_detail)
   → trả lời + gắn lợi ích:
      - không trả lời khô
      - luôn thêm WHY BUY

2. Chủ động dẫn dắt:
   - hỏi nhu cầu cụ thể:
     thời trang:
        → size? form rộng/ôm? nam/nữ?
     mỹ phẩm:
        → da gì? mục tiêu gì?

3. Thuyết phục (CORE):
   - dùng:
     + social proof
     + lợi ích cụ thể
     + giảm rủi ro

4. Luôn có CTA mềm:
   - "Mẫu này đang rất nhiều khách lấy, bạn muốn mình giữ hàng trước không?"

-> giúp thiết kế giai đoạn này chuẩn như ngoài đời, khúc này quan trọng
-> sẽ chiếm phần lớn chat, là lúc định hình nhu cầu cho khách hàng, thuyết phục khách hàng từ hot data thành mua hàng -> rất quan trọng
-> làm sao tối ưu nhanh nhất, dùng thông tin về sp và thuyết phục khách mua hàng, họ là hot data đã rất gần rồi




- xác nhận mua sp này: chốt với khách các trường biến thể sản phẩm
-> từ llm trả về, giúp khách hàng chọn đúng biến thể để chốt đơn, và logic sao khi khách thiếu là phải hỏi để update đủ để qua giai đoạn lấy thông tin khách hàng



4. lấy thông tin gửi hàng

hỏi khách về trường cố định
logic giúp khách hàng đưa đủ thông tin, và logic sao khi khách thiếu là phải hỏi để update đủ để qua giai đoạn lấy thông tin khách hàng

trường cố định:
tên, sdt, địa chỉ, giá, phí ship


