#!/usr/bin/env bash
# Assembles and deploys the STAGING custom Jitsi web image on the server, using a pre-built
# webapp/ tarball (produced locally by `make compile && make deploy`, per
# debian/jitsi-meet-web.install) transferred to the server. Does NOT touch the production
# `web` service, JVB, Jicofo, Prosody or coturn -- only builds/starts a new, separate
# `web-staging` container on 127.0.0.1:8543.
#
# Run this ON THE SERVER from /opt/toowix/jitsi-toowix (this repo's checkout there), after
# the webapp.tar.gz produced locally has been scp'd to /opt/toowix/staging-build/webapp.tar.gz
# and web-rootfs has been copied from /opt/toowix/jitsi-stack/web/rootfs.
set -euo pipefail

STAGING_DIR=/opt/toowix/staging-build
mkdir -p "$STAGING_DIR/webapp"

echo "== Extracting pre-built webapp =="
tar -xzf "$STAGING_DIR/webapp.tar.gz" -C "$STAGING_DIR/webapp"

echo "== Copying rootfs from the existing docker-jitsi-meet checkout (unmodified, matches production) =="
rm -rf "$STAGING_DIR/web-rootfs"
cp -r /opt/toowix/jitsi-stack/web/rootfs "$STAGING_DIR/web-rootfs"

echo "== Building toowix-jitsi-web:staging =="
cp /opt/toowix/jitsi-toowix/docker/web-staging.Dockerfile "$STAGING_DIR/Dockerfile"
docker build -t toowix-jitsi-web:staging -f "$STAGING_DIR/Dockerfile" "$STAGING_DIR"

echo "== Starting web-staging (127.0.0.1:8543 only, same meet.jitsi network, real backend) =="
cd /opt/toowix/jitsi-stack
docker compose -f docker-compose.yml -f /opt/toowix/jitsi-toowix/docker/docker-compose.web-staging.yml up -d web-staging

echo "== Done. Tunnel with: ssh -L 8543:localhost:8543 root@192.168.22.59 =="
echo "== Then open: https://localhost:8543/<room-name> =="
