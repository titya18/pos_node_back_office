# Step 1: Build the app
FROM node:18 AS builder

WORKDIR /app

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Install dependencies (including dotenv)
RUN npm install

# Copy the rest of the source code
COPY . .

# Generate Prisma client
Run npx prisma generate

# Build the TypeScript files
RUN npm run build

# Start the server
CMD ["node", "dist/src/server.js"]