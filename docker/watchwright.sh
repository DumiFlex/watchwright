#!/bin/sh
# The `watchwright` command in the image, for the container's start and for `docker exec`.
# Started as root, it first gives /data and /packs to the container's user (pwuser) when they
# belong to someone else, as folders Docker or Portainer made for a bind mount do, and then runs
# Watchwright as pwuser. So a fresh stack works without chown on the host, and a command run with
# `docker exec` never leaves files only root can change.
set -e
main=@MAIN@
if [ "$(id -u)" = "0" ]; then
  owner=$(id -u pwuser)
  for dir in "${WATCHWRIGHT_DATA:-/data}" /packs; do
    mkdir -p "$dir"
    if [ "$(stat -c %u "$dir")" != "$owner" ]; then
      echo "Giving $dir to the container's user (pwuser, uid $owner)."
      chown -R pwuser:pwuser "$dir" || echo "Couldn't give $dir to uid $owner; Watchwright may not be able to write there."
    fi
  done
  exec setpriv --reuid=pwuser --regid=pwuser --init-groups env HOME=/home/pwuser node "$main" "$@"
fi
exec node "$main" "$@"
