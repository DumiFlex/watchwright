#!/usr/bin/env bash
# Starts the image, waits for it to be healthy, and checks what a first start should do: login on,
# the first-admin link in the log, and the folder browser kept in /packs with no file manager.
# Used by CI; run it by hand with an image tag: bash docker/smoke.sh watchwright:test
set -euo pipefail
image="${1:?image tag}"
name="watchwright-smoke-$$"
port=$((20000 + RANDOM % 20000))
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" --init --shm-size 1g -p "127.0.0.1:$port:7420" -e WATCHWRIGHT_PUBLIC_URL="http://localhost:$port" "$image" >/dev/null
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$state" = "healthy" ] && break
  sleep 2
done
docker logs "$name"
[ "$state" = "healthy" ] || { echo "The container didn't become healthy ($state)."; exit 1; }

health=$(curl -fsS "http://localhost:$port/api/v1/health")
echo "$health" | grep -q '"on":true' || { echo "Login isn't on: $health"; exit 1; }
code=$(docker logs "$name" 2>&1 | grep -o 'setup?code=[A-Za-z0-9_-]*' | head -n 1 | cut -d= -f2)
[ -n "$code" ] || { echo "No first-admin link in the log."; exit 1; }

# The first admin, through the setup link, then a token for the API.
jar=$(mktemp)
curl -fsS -c "$jar" -H 'content-type: application/json' -d "{\"code\":\"$code\",\"name\":\"admin\",\"password\":\"a long password for ci\"}" "http://localhost:$port/api/v1/auth/setup" >/dev/null
places=$(curl -fsS -b "$jar" "http://localhost:$port/api/v1/folders/places")
echo "$places" | grep -q '"start":"/packs"' || { echo "The folder browser doesn't start in /packs: $places"; exit 1; }
echo "$places" | grep -q '"canOpen":false' || { echo "A server without a screen offers to open folders: $places"; exit 1; }
outside=$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "http://localhost:$port/api/v1/folders?path=/etc")
[ "$outside" = "403" ] || { echo "Browsing /etc answered $outside, not 403."; exit 1; }
echo "The image starts, asks for the first admin, and keeps the folder browser in /packs."
