# FB Page Manager - Post Intelligence Service

---

## ⚠️ QUYẾT ĐỊNH KIẾN TRÚC LỚN

### Bỏ Product Layer (product_from_posts)

**Quyết định:** Không còn bảng `product_from_posts`, `post_products`, `product_media_vectors` trong luồng xử lý chính.

**Lý do:** `product_from_posts` chỉ là sản phẩm _dự đoán_ từ bài viết, không phải sản phẩm thực tế. Việc dedup theo tên sản phẩm không đáng tin cậy (cùng tên nhưng khác sản phẩm). Thay vào đó, dùng thẳng `posts` + Qdrant làm nguồn dữ liệu cho mọi truy vấn.

**Hệ quả:**
- Nguồn dữ liệu duy nhất: bảng `posts` (PostgreSQL) + `post_embeddings` / `product_images` (Qdrant)
- Không còn route `GET /api/intelligence/products`
- Không còn tab Sản phẩm trên frontend
- Qdrant `product_images` vẫn lưu `product_name` từ LLM extraction (không có `product_id`)
- Các bảng cũ (`product_from_posts`, `post_products`, `product_media_vectors`) giữ nguyên trong DB nhưng không ghi vào nữa

---

## 📋 CONTEXT HIỆN TẠI

- ✅ Docker đã setup
- ✅ PostgreSQL đang chạy
- ✅ Facebook login hoạt động
- ✅ Crawl posts cơ bản đã có
- Tech stack: Node.js backend, Next.js frontend, Python AI service

---

## 🎯 YÊU CẦU MỚI


👉 fb-page-manager

Dịch vụ này là một ✅Product intelligence graph từ social data Facebook để AI Chat để nắm được sản phẩm & promotion từ posts để tư vấn, mà chưa cần có product thực tế từ website user.
Không làm AI chat, chỉ tập trung làm Product intelligence graph từ social data

-----------------------
GIẢI THÍCH ĐƠN GIẢN HOÁ TÁC VỤ

1. graph 500 posts từ fanpage
2. có llm tạo các trường cho products, chương trình ưu đãi từ posts
3. embedding những trường quan trọng phục vụ cho AI Chat về sau
4. trữ vào db, để sau AI về sau sẽ truy vấn và tư vấn có cở sở nhất

-------------------

# Có Tính Năng Upadte lần Đầu, và tự đồng bộ khi user có bài posts mới từ fanpage
# Những ID Posts nào đã update vào db rồi về sau có nhấn update cũng k update trùng lập vào db

# 🧠 MỤC TIÊU

Hệ thống phải:

1. Thu thập thông tin từ các trang Facebook (qua Graph API hoặc API giả lập)
2. Lấy Graph 500 bài posts, sẽ có điều kiện lọc để lưu trữ dữ liệu bài đăng vào PostgreSQL

3. Đưa text vào llm để lấy trường cần thiết (
extracted_product_name string,
price int,
what_is_product string,
product_count int, 
is_sale_post boolean,
what_is_promotion string)


Điều Kiện Lọc trước để xử lí tiếp, k đủ điều kiện thì skip: (Sau khi có kết quả từ llm)

- AI phát hiện posts có phải là post bán hàng (is_sale_post) không -> No -> K lưu DB
- định dạng video -> k lưu db
- post mà có hơn 5 hình ảnh -> skip, k xử lí
- (update price mới) | extracted_product_name đã có trong Bảng product_from_posts, nếu có price từ post và post_created_time_on_FB mới nhất so với product_from_posts, thì update price mới đó vào -> lưu price mới vào product_from_posts



4. embedding cho ảnh (chỉ với posts pass LLM), để khách hàng truy vấn AI sẽ tìm cho dễ
Tư duy đúng: Ảnh chỉ tồn tại trong RAM vài giây → embed → xoá
Không lưu file, không lưu ổ cứng, không lưu DB ảnh.
Chỉ lưu vector.

Hướng thực hiện:
Download ảnh qua stream → RAM (BytesIO)
Resize (256–512px) ngay trong RAM
Tạo embedding hình ảnh (CLIP hoặc mô hình tương tự tiết kiệm)
Push vào vector DB (Qdrant)
Xoá khỏi RAM
-> lưu trữ vào các db cần các trường image_embedding

5. lưu các trường vào các db Posts, post_media, product_from_posts, post_products product_media_vectors

6. Đảm bảo hệ thống an toàn khi gặp sự cố, có thể khôi phục và không có dữ liệu trùng lặp
7. Hỗ trợ nhiều người dùng và nhiều trang Facebook



---

# 🗄️ THIẾT KẾ CƠ SỞ DỮ LIỆU

## 1. Table Posts ( Bảng bài đăng )

Các trường:

- post_id (chuỗi, duy nhất với page_id)

- page_id

- user_id
- content (văn bản)

- is_sale_post (boolean, LLM)
- is_single_product_post (boolean, LLM)
- product_count (int, LLM)
- extracted_product_name (string, LLM)
- price (int, LLM)

- post_embedding (vector hoặc mảng JSON float)
- post_created_time_on_FB
- created_time
- synced_time
- status (active/ignored)

Ràng buộc:

- UNIQUE(post_id, page_id)


------------------------------

## 2. Bảng post_media

Các trường:

- media_id (uuid)

- post_id (FK)

- user_id
- image_url
- image_embedding (vector)
- image_hash (perceptual hash)
- width
- height
- created_at
- embedding_status (pending/done/failed)

Ràng buộc:

- UNIQUE(media_id)



------------------------------

## 3. Bảng product_from_posts

product_id
user_id
product_name
normalized_name
what_is_product
what_is_promotion
name_confidence
first_post_id
first_page_id
mention_count
current_price
image_url (ảnh đại diện sản phẩm — lấy từ ảnh đầu tiên của post phát hiện SP; không ghi đè nếu đã có)
status
first_seen_at
last_seen_at
created_at

------------------------------

## 4 post_products 

id
post_id
page_id
product_id
extracted_product_name
confidence
is_primary
product_count
created_at

------------------------------

## 5 product_media_vectors 
id
product_id
product_name
post_id
page_id
image_url
image_embedding
product_reference_embedding
similarity_score
is_primary
created_at

---------------------------------

## 6. Bảng crawl_logs

Các trường:

- log_id
- user_id
- page_id
- posts_crawled
- posts_saved
- posts_skipped
- media_processed
- status
- time_taken
- created_at


---

# 🚨 QUY TẮC QUAN TRỌNG

- Phải có tính bất biến (không có bài đăng hoặc phương tiện trùng lặp)

- Phải hỗ trợ khôi phục sau khi gặp sự cố
- Phải sử dụng kiến ​​trúc bất đồng bộ + hàng đợi

- Phải tách biệt việc thu thập thông tin, xử lý và nhúng thành các worker
- KHÔNG được phụ thuộc vào cơ sở dữ liệu sản phẩm hoặc dịch vụ sản phẩm
- Việc đối sánh sản phẩm KHÔNG phải là một phần của dịch vụ này




---

# 🏗️ KIẾN TRÚC

Có nodejs xử lí backend cho website
frontend nextjs
AI service là Python backend


---

# ⚙️ QUY TRÌNH XỬ LÝ

## Giai đoạn 1: Thu thập dữ liệu
- lấy bài đăng từ API của Facebook
- Đưa text vào llm để lấy trường cần thiết

## Giai đoạn 2: Lọc
- có điều kiện lọc skip những post không cần thiết


## Giai đoạn 3: Xử lý phương tiện
- Trích xuất URL hình ảnh
- Lưu vào post_media (chưa nhúng)

## Giai đoạn 4: Xử lý nhúng
- Tải hình ảnh tạm thời (chỉ luồng)

- Tạo nhúng CLIP
- Lưu trữ nhúng trong DB hoặc Qdrant
- Xóa tệp tạm thời ngay lập tức

## Giai đoạn 5: Lưu vào DB các table
- (Bất biến)

---

# 🚨 YÊU CẦU AN TOÀN KHI SỰ CỐ

Phải triển khai:

1. Chèn cơ sở dữ liệu bất biến (không trùng lặp)

2. Tiếp tục bằng cách kiểm tra post_id hiện có
3. Theo dõi trạng thái nhúng phương tiện
4. Cơ chế thử lại hàng đợi
5. Xử lý theo lô (không phải một yêu cầu cho mỗi mục)
6. Các worker không trạng thái

---

# ⚡ YÊU CẦU HIỆU NĂNG

- Phải hỗ trợ hơn 1000 bài đăng mỗi lô thu thập dữ liệu
- Phải hỗ trợ hơn 5000 hình ảnh mỗi phiên nhập liệu
- Không được tải tất cả hình ảnh vào bộ nhớ
- Phải sử dụng IO bất đồng bộ cho việc tải xuống
- Phải hỗ trợ Mở rộng quy mô theo chiều ngang của các worker

---

# 🐳 YÊU CẦU DOCKER

Phải bao gồm:

- docker-compose.yml

- các dịch vụ:

- api

- worker

- postgres

- redis

- qdrant

---

# 🧪 YÊU CẦU KIỂM THỬ

Phải bao gồm:

- các điểm cuối kiểm thử giao diện người dùng đơn giản HOẶC API:

- kích hoạt thu thập dữ liệu

- xem bài đăng

- xem các nội dung nhúng đa phương tiện
- các điểm cuối kiểm tra trạng thái
- các điểm cuối gỡ lỗi để kiểm tra cơ sở dữ liệu

---

# 📦 KẾT QUẢ MONG ĐỢI

Tạo cấu trúc dự án hoàn chỉnh:

- Backend 
- Các worker 
- Mô hình cơ sở dữ liệu ( hoặc tương đương)

- Thiết lập Docker
- Hệ thống hàng đợi
- Đường dẫn nhúng
- Các điểm cuối kiểm thử cơ bản

Mã phải đạt chuẩn sản xuất, có tính mô-đun và có khả năng mở rộng.

Không cần thiết kế quá phức tạp, nhưng mã phải sạch sẽ và sẵn sàng cho việc triển khai thực tế.

 

---

## 📝 WORKFLOW YÊU CẦU

1. Phân tích toàn bộ requirements
2. Chia thành 8-12 phases nhỏ (mỗi phase 15-20 phút)
3. Mỗi phase tạo 1-3 files
4. Sau mỗi phase hỏi tôi review
5. Code phải production-ready, có error handling
6. Comments bằng tiếng Việt