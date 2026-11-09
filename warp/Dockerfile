# Cloudflare WARP as an HTTP proxy for the downloader, without a VPN interface:
# wgcf registers an anonymous WARP device and writes a WireGuard profile, and
# wireproxy runs that profile in user space and serves an HTTP proxy on 8080.
FROM alpine:3.22
ARG TARGETARCH
ARG WGCF=2.3.1
ARG WIREPROXY=1.1.3
RUN set -eu; apk add --no-cache ca-certificates curl; \
    case "$TARGETARCH" in \
      amd64) w=4fb7a136aa470ece11d17949c7db07b040ec9c604742dc8680bcf1889f85d0c8; p=e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c ;; \
      arm64) w=710ab2d8ac145d81a4cf0c11bdb0e05914f77ae2a45f67b87e718d84b4cb7301; p=370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /usr/local/bin/wgcf "https://github.com/ViRb3/wgcf/releases/download/v$WGCF/wgcf_${WGCF}_linux_$TARGETARCH"; \
    echo "$w  /usr/local/bin/wgcf" | sha256sum -c -; \
    curl -fsSLo /tmp/wp.tgz "https://github.com/whyvl/wireproxy/releases/download/v$WIREPROXY/wireproxy_linux_$TARGETARCH.tar.gz"; \
    echo "$p  /tmp/wp.tgz" | sha256sum -c -; \
    tar -xzf /tmp/wp.tgz -C /usr/local/bin wireproxy; rm /tmp/wp.tgz; \
    chmod 755 /usr/local/bin/wgcf /usr/local/bin/wireproxy; apk del curl
COPY entrypoint.sh /entrypoint.sh
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
