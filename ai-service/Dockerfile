FROM python:3.11-slim
WORKDIR /app

# Cài deps trước (cache layer)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
ENV HOST=0.0.0.0

CMD ["python", "main.py"]
