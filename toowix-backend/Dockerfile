# toowix-backend -- main API. Listens on PORT (default 4000).
# Build:  docker build -t toowix-backend -f toowix-backend/Dockerfile toowix-backend
# Run:    docker run -d --name toowix-backend -p 4000:4000 --env-file .env toowix-backend
#
# After ANY deploy whose commits add, change, or remove a schema.index(...) call in src/models/ --
# run this manually, once, against the production database, after the new image is running:
#   npm run db:indexes   (ts-node src/db/initIndexes.ts; runs Model.syncIndexes() per model)
# NOT run automatically on container start (src/index.ts does not call it) -- syncIndexes can drop
# and rebuild indexes on a large collection, which is slow and can block other operations on it, so
# it must stay a deliberate step you run when you know an index actually changed, not on every
# boot. There is no CI/CD pipeline in this repo for toowix-backend (deploy is manual; see
# docker-compose.web-staging.yml for the current staging process) -- if that changes, add this as
# a step after the new image is deployed and before traffic depends on the new index.

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
RUN apk add --no-cache ffmpeg
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/src/index.js"]
