# Watchwright in a container: the server, its web app and Playwright's browsers, for a homelab or
# a server (docs/plans/self-hosting.md, section 5). Built and pushed to ghcr.io/dumiflex/watchwright
# by the release workflow; see the Self-hosting guide for running it.
#
#   docker build -t watchwright docker/                                   # watchwright from npm
#   docker build --build-arg WATCHWRIGHT_VERSION=0.11.0 -t watchwright docker/
#
# A packed tarball in docker/dist/ (pnpm --filter watchwright pack --pack-destination docker/dist)
# is installed instead of npm, so CI and the release can build the image before npm has the version.

# Playwright's own image: Ubuntu with every browser's system libraries, the browsers and ffmpeg.
ARG PLAYWRIGHT_VERSION=1.64.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG WATCHWRIGHT_VERSION=latest
COPY dist/ /tmp/watchwright/
RUN set -eux; \
    tgz=$(find /tmp/watchwright -name 'watchwright-*.tgz' | head -n 1); \
    if [ -n "$tgz" ]; then npm install -g "$tgz"; else npm install -g "watchwright@${WATCHWRIGHT_VERSION}"; fi; \
    rm -rf /tmp/watchwright; \
    # The browsers for the Playwright version watchwright resolved; nothing to fetch when it matches the image.
    cd "$(npm root -g)/watchwright" && npx --no-install playwright install chromium firefox; \
    npm cache clean --force; \
    mkdir -p /data /packs; \
    chown pwuser:pwuser /data /packs

# Server mode: no desktop (headless browsers, no file manager), login always on, the folder
# browser kept inside /packs. WATCHWRIGHT_PUBLIC_URL is the address people open; set it when running.
ENV WATCHWRIGHT_DATA=/data \
    WATCHWRIGHT_FOLDERS=/packs \
    WATCHWRIGHT_AUTH=on \
    WATCHWRIGHT_SERVER_HOST=1 \
    WATCHWRIGHT_HOST=0.0.0.0 \
    NODE_ENV=production

USER pwuser
WORKDIR /packs
VOLUME ["/data", "/packs"]
EXPOSE 7420

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7420/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["watchwright", "serve", "--no-open"]
