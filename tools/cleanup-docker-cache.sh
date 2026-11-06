#!/bin/sh
# Rebuildable cache only. Never prune volumes or stop containers.
set -eu
exec 9>/home/gleb/.local/bin/.docker-cache-cleanup.lock
flock -n 9 || exit 0
docker builder prune -f --filter until=168h --keep-storage 2GB
docker image prune -f --filter until=168h
