#!/usr/bin/env bash
set -u

BRANCH="${CODESPACES_SYNC_BRANCH:-preview/dev-console-ui}"
PID_FILE="/tmp/sra-luck-codespaces-sync.pid"
LOG_FILE="/tmp/sra-luck-codespaces-sync.log"

if [ "${CODESPACES:-}" != "true" ]; then
  echo "Auto-sync ignorado: este ambiente não é um GitHub Codespace."
  exit 0
fi

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Auto-sync já está ativo (PID $OLD_PID)."
    exit 0
  fi
fi

nohup bash -lc '
  BRANCH="'"$BRANCH"'"
  PID_FILE="'"$PID_FILE"'"
  echo $$ > "$PID_FILE"
  trap '\''rm -f "$PID_FILE"'\'' EXIT

  while true; do
    if [ "$(git branch --show-current 2>/dev/null)" = "$BRANCH" ]; then
      if git fetch -q origin "$BRANCH"; then
        LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
        REMOTE_SHA="$(git rev-parse "origin/$BRANCH" 2>/dev/null || true)"

        if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
          if git diff --quiet && git diff --cached --quiet; then
            git reset --hard "origin/$BRANCH"
            echo "[$(date -Iseconds)] atualizado para $REMOTE_SHA"
          else
            echo "[$(date -Iseconds)] atualização pendente: há alterações locais no Codespace"
          fi
        fi
      fi
    fi
    sleep 10
  done
' >>"$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
echo "Auto-sync ativo para $BRANCH. Log: $LOG_FILE"
