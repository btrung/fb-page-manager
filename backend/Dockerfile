# =============================================
# PRODUCTION — multi-stage build
# Stage 1: build React frontend
# Stage 2: Node.js backend + serves static
# =============================================

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend runtime
FROM node:20-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ ./

# Copy frontend build — backend serves ../frontend/dist in prod
COPY --from=frontend-builder /frontend/dist /frontend/dist

EXPOSE 5000
ENV NODE_ENV=production

CMD ["node", "server.js"]
