FROM python:3.11-slim
WORKDIR /app

# Cài system deps cần thiết cho Pillow + requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cài torch CPU trước (tránh tải GPU version ~2GB)
RUN pip install --no-cache-dir \
    torch==2.2.1+cpu \
    torchvision==0.17.1+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# Cài các deps còn lại
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
ENV HOST=0.0.0.0

CMD ["python", "main.py"]
