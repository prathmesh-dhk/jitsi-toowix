# toowix-web-app -- main frontend. Nginx serves the built static bundle on port 3000.
# All VITE_* values are baked in at BUILD time (Vite has no runtime env) -- override
# them with --build-arg for a different backend host or Firebase project.
#
# Build:  docker build -t toowix-web-app -f toowix-web-app/Dockerfile toowix-web-app \
#           --build-arg VITE_API_URL=http://192.168.22.59:4000
# Run:    docker run -d --name toowix-web-app -p 3000:3000 toowix-web-app

# ---- Stage 1: build static assets ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_API_URL=http://192.168.22.59:4000
ARG VITE_FIREBASE_API_KEY=AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU
ARG VITE_FIREBASE_AUTH_DOMAIN=toowix-meet-ff587.firebaseapp.com
ARG VITE_FIREBASE_PROJECT_ID=toowix-meet-ff587
ARG VITE_FIREBASE_STORAGE_BUCKET=toowix-meet-ff587.firebasestorage.app
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=227073296532
ARG VITE_FIREBASE_APP_ID=1:227073296532:web:18ad80d461ae6d5a3f4c81
ARG VITE_FIREBASE_MEASUREMENT_ID=G-7MSJNM4L0R
ARG VITE_JITSI_DOMAIN=talk.toowix.com

ENV VITE_API_URL=$VITE_API_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID \
    VITE_JITSI_DOMAIN=$VITE_JITSI_DOMAIN

RUN npm run build

# ---- Stage 2: Nginx serving the built SPA ----
FROM nginx:1.27-alpine
RUN sed -i 's/worker_processes auto;/worker_processes 2;/' /etc/nginx/nginx.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
