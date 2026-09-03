# toowix-backend -- main API. Listens on PORT (default 4000).
# Build:  docker build -t toowix-backend -f toowix-backend/Dockerfile toowix-backend
# Run:    docker run -d --name toowix-backend -p 4000:4000 --env-file .env toowix-backend

# ---- Stage 1: compile TypeScript ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: production runtime, prod deps only ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/src/index.js"]
