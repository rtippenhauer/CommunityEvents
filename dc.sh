#!/usr/bin/env bash
# Usage: ./dc.sh [up|up-build|down|logs|ps]
# Wraps docker compose with the correct project-directory and env-file flags.

COMPOSE="docker compose --project-directory . -f docker/docker-compose.yml"

case "${1:-up}" in
  up)        $COMPOSE up --remove-orphans ;;
  up-build)  $COMPOSE up --build --remove-orphans ;;
  build)     $COMPOSE build ;;
  down)      $COMPOSE down --remove-orphans ;;
  logs)      $COMPOSE logs -f ;;
  ps)        $COMPOSE ps ;;
  *)         $COMPOSE "$@" ;;
esac
