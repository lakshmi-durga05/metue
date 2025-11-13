# syntax=docker/dockerfile:1

# Install all dependencies (including dev) once for caching
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Client (Vite) ----------
FROM node:20-alpine AS client
WORKDIR /app
# Reuse deps (includes devDependencies for Vite)
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build static assets
RUN npm run build
# Serve with Vite preview
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]

# ---------- Server (Express + Socket.IO) ----------
FROM node:20-alpine AS server
WORKDIR /app
# Only production deps for smaller image
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Ensure ffmpeg is available for fluent-ffmpeg (ffmpeg-static may not work on musl)
RUN apk add --no-cache ffmpeg
# Copy only what server needs
COPY server ./server
# Create transcripts directory at runtime if not exists (server code also ensures it)
EXPOSE 3001
CMD ["node", "server/index.js"]
