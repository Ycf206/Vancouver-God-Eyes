FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy all files
COPY . .

# Accept build-time environment variable for Next.js build
ARG NEXT_PUBLIC_ADMIN_API_SECRET
ENV NEXT_PUBLIC_ADMIN_API_SECRET=$NEXT_PUBLIC_ADMIN_API_SECRET

# Build Next.js application
RUN npm run build

EXPOSE 3000

# Start the application
CMD ["npm", "start"]
