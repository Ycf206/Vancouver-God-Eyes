FROM node:18-alpine

WORKDIR /app

# 優化 Node.js 記憶體限制 (2048MB)，防範記憶體溢位 (OOM)
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy all files
COPY . .

# 注意：切勿在此注入 NEXT_PUBLIC_ADMIN_API_SECRET 等後端密鑰，以防密鑰被編譯進公開瀏覽器靜態資源

# Build Next.js application
RUN npm run build

EXPOSE 3000

# Start the application
CMD ["npm", "start"]
