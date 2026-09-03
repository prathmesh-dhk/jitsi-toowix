# toowix-backend -- main API. Listens on PORT (default 4000).
# Build:  docker build -t toowix-backend -f toowix-backend/Dockerfile toowix-backend
# Run:    docker run -d --name toowix-backend -p 4000:4000 -v "$(pwd)/.env:/app/.env:ro" toowix-backend
# NOTE: use a bind-mounted .env (not --env-file) -- the app calls dotenv.config() itself,
# which strips quotes and expands \n in quoted values (e.g. FIREBASE_PRIVATE_KEY,
# DEV_ADMIN_PASSWORD). Docker's own --env-file parser does neither, so a quoted value
# like DEV_ADMIN_PASSWORD="foo#bar" ends up as the literal string `"foo#bar"` including
# the quote characters, silently breaking any comparison against it.

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
