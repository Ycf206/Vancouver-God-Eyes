FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy all files
COPY . .

# Build Next.js application
RUN npm run build

EXPOSE 3000

# Start the application
CMD ["npm", "start"]
