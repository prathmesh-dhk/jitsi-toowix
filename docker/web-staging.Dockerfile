# STAGING-ONLY custom Jitsi Meet web image, assembled from a pre-built tarball of this repo's
# customized source (react/features/, css/) instead of the stock `jitsi-meet-web` apt package
# used by ghcr.io/jitsi/web. The production `web` container (jitsi-stack-web-1, pinned image
# ghcr.io/jitsi/web@sha256:ff24ab42b15ade701783084d073b5f1c58073b6ae2ed2f934151d2a23e2efc0c) is
# left completely untouched -- this builds a SEPARATE image for a SEPARATE staging
# container/port, pointed at the same Prosody/JVB/Jicofo backend. Do not use this to replace
# the production web container until it has been visually verified on staging.
#
# Build context for this Dockerfile must contain:
#   - webapp/   (the pre-built static files: interface_config.js, *.html, libs/, static/,
#                css/all.css, sounds/, fonts/, images/, lang/, scripts/, manifest.json,
#                pwa-worker.js -- mirrors debian/jitsi-meet-web.install exactly)
#   - web-rootfs/  (copied as-is from the existing docker-jitsi-meet checkout already on this
#                server at /opt/toowix/jitsi-stack/web/rootfs, so s6 services / nginx templates
#                / env var handling match production exactly -- only the static app differs)

FROM ghcr.io/jitsi/base:unstable
USER root

RUN \
  apt-dpkg-wrap apt-get update && \
  apt-dpkg-wrap apt-get install -y \
    dnsutils \
    jq \
    nginx-extras \
    socat \
    && \
  apt-cleanup

COPY web-rootfs/ /
COPY webapp/ /usr/share/jitsi-meet/

RUN \
  mv /usr/share/jitsi-meet/interface_config.js /defaults && \
  chmod 0755 /opt/acme.sh 2>/dev/null || true && \
  ln -sf /run/web/.well-known /usr/share/jitsi-meet/.well-known && \
  rm -f /etc/nginx/conf.d/default.conf && \
  rm -rf /var/lib/nginx && \
  ln -s /run/web/tmp /var/lib/nginx && \
  mkdir -p /storage && \
  chown s6:s6 /storage

EXPOSE 8000 8443
VOLUME ["/config", "/usr/share/jitsi-meet/transcripts"]
USER s6
