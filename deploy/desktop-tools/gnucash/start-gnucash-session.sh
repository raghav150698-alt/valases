#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
export HOME="/home/${TOOL_USER:-candidate}"
export SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1600x900x24}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export VNC_PORT="${VNC_PORT:-5901}"

mkdir -p "${HOME}/.vnc" /tmp/.X11-unix /workspace
rm -f /tmp/.X1-lock

Xvfb "${DISPLAY}" -screen 0 "${SCREEN_GEOMETRY}" -ac +extension RANDR &
XVFB_PID=$!

for _ in $(seq 1 20); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

openbox --sm-disable &
OPENBOX_PID=$!

su - "${TOOL_USER:-candidate}" -c "export DISPLAY='${DISPLAY}'; export HOME='${HOME}'; dbus-launch --exit-with-session gnucash --nofile" &
GNUCASH_PID=$!

for _ in $(seq 1 20); do
  if wmctrl -l | grep -qi "GnuCash"; then
    wmctrl -r "GnuCash" -b add,maximized_vert,maximized_horz || true
    break
  fi
  sleep 1
done

x11vnc \
  -display "${DISPLAY}" \
  -rfbport "${VNC_PORT}" \
  -localhost \
  -forever \
  -shared \
  -nopw \
  -quiet &
X11VNC_PID=$!

websockify \
  --web /usr/share/novnc/ \
  "${NOVNC_PORT}" \
  "localhost:${VNC_PORT}" &
WEBSOCKIFY_PID=$!

cleanup() {
  kill "${WEBSOCKIFY_PID}" "${X11VNC_PID}" "${GNUCASH_PID}" "${OPENBOX_PID}" "${XVFB_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait "${GNUCASH_PID}"
