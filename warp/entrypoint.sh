#!/bin/sh
# The registration (wgcf-account.toml) and WireGuard profile live in /data, so
# the device is registered once and reused across restarts.
set -eu
cd /data
[ -f wgcf-account.toml ] || wgcf register --accept-tos
[ -f wgcf-profile.conf ] || wgcf generate
cat > /tmp/wireproxy.conf <<EOF
WGConfig = /data/wgcf-profile.conf

[http]
BindAddress = 0.0.0.0:8080
EOF
exec wireproxy -c /tmp/wireproxy.conf
