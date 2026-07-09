FROM node:18-alpine as builder

WORKDIR /app
ARG VITE_API_URL=http://localhost:5050
ENV VITE_API_URL=$VITE_API_URL

# Copy package files
COPY package*.json ./

# Install dependencies, including Vite for the build step
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install serve to run the app
RUN npm install -g serve

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 5173

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5173/ || exit 1

# Start the app
CMD ["serve", "-s", "dist", "-l", "5173"]
