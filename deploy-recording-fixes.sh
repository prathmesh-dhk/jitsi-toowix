#!/bin/bash
# Run this ON THE SERVER (root@192.168.22.59), from anywhere -- paths are absolute.
# Deploys 3 fixes: Jibri fake-participant bug, recording playback 404, recording
# share-link opening stock Jitsi. Does NOT touch the 6-menu-features work (still
# stashed locally, untested).
set -euo pipefail

echo "== 0. Safety check: no active meetings =="
CONFS=$(docker exec jitsi-stack-jicofo-1 curl -s http://localhost:8888/stats | grep -o '"conferences":[0-9]*' | grep -o '[0-9]*')
if [ "$CONFS" != "0" ]; then
  echo "ABORT: $CONFS active conference(s). Re-run when empty."
  exit 1
fi
echo "OK, 0 active conferences."

echo "== 1. Pull latest code =="
cd /opt/toowix/jitsi-toowix
git fetch origin ui-restore-jitsi-tiles-staging
git checkout ui-restore-jitsi-tiles-staging
git merge --ff-only origin/ui-restore-jitsi-tiles-staging

echo "== 2. Fix nginx routing (recordings/recording/rsvp/meeting-ended/meet-direct -> toowix-web-app) =="
cp /opt/toowix/talk-proxy.conf "/opt/toowix/talk-proxy.conf.bak-$(date +%Y%m%dT%H%M%S)"
cat > /opt/toowix/talk-proxy.conf <<'NGINXEOF'
server {
    listen 3000;
    server_name _;

    location ~ ^/meet/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
    location ~ ^/meet-direct/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
    location ~ ^/(dashboard|home|login|signin|signup|register|forgot-password|verify-email|settings|rsvp|recordings|recording|meeting-ended)(/|$) {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
    location = / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
    location /assets/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
    location = /lib-jitsi-meet.min.js {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
    location = /favicon.ico {
        proxy_pass http://127.0.0.1:3001;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }

    location /xmpp-websocket {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;
        proxy_buffering off;
        tcp_nodelay on;
    }

    location /http-bind {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;
    }
}
NGINXEOF
docker exec talk-router nginx -t
docker exec talk-router nginx -s reload
echo "nginx reloaded."

echo "== 3. Rebuild + redeploy toowix-backend (picks up the already-committed /stream route) =="
docker build -t toowix-backend:recording-fix-2 /opt/toowix/jitsi-toowix/toowix-backend
docker stop toowix-backend
docker rename toowix-backend toowix-backend-before-fix2-$(date +%Y%m%dT%H%M%S)
docker run -d --name toowix-backend --restart unless-stopped -p 4000:4000 \
  -v /opt/toowix/jitsi-stack-config/storage/jibri/recordings:/recordings-storage:ro \
  -v /opt/toowix/jitsi-toowix/toowix-backend/.env:/app/.env:ro \
  -v /opt/toowix/jitsi-toowix/toowix-backend/serviceAccountKey.json:/app/serviceAccountKey.json:ro \
  toowix-backend:recording-fix-2
sleep 3
curl -sf http://127.0.0.1:4000/health || echo "WARNING: backend health check did not return 200 -- check 'docker logs toowix-backend'"

echo "== 4. Rebuild + redeploy toowix-web-app (Jibri fake-participant fix) =="
docker build -t toowix-web-app:jibri-fix \
  --build-arg VITE_API_URL=https://talk.toowix.com \
  /opt/toowix/jitsi-toowix/toowix-web-app
docker stop toowix-web-app
docker rename toowix-web-app toowix-web-app-before-jibri-fix-$(date +%Y%m%dT%H%M%S)
docker run -d --name toowix-web-app --restart unless-stopped -p 127.0.0.1:3001:3000 \
  toowix-web-app:jibri-fix
sleep 3
curl -sf http://127.0.0.1:3001 > /dev/null && echo "Frontend is up." || echo "WARNING: frontend did not respond -- check 'docker logs toowix-web-app'"

echo "== 5. Verify =="
echo "--- stream route (should be 404 JSON 'Recording not available', NOT 'Cannot GET') ---"
curl -s https://talk.toowix.com/api/recordings/000000000000000000000000/stream
echo
echo "--- recordings page routing (should NOT be stock Jitsi HTML) ---"
curl -s https://talk.toowix.com/recordings/000000000000000000000000 | head -5
echo
echo "Done. Old containers renamed with a timestamp suffix (not removed) -- safe to roll back if needed."
