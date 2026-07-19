FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    SCREEN_GEOMETRY=1600x900x24 \
    NOVNC_PORT=6080 \
    VNC_PORT=5901 \
    TOOL_USER=candidate

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        dbus-x11 \
        gnucash \
        novnc \
        openbox \
        python3-xdg \
        python3-websockify \
        wmctrl \
        x11-utils \
        x11vnc \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash "${TOOL_USER}" \
    && mkdir -p /opt/desktop-tool /workspace \
    && chown -R "${TOOL_USER}:${TOOL_USER}" /opt/desktop-tool /workspace

COPY start-gnucash-session.sh /usr/local/bin/start-gnucash-session.sh
RUN chmod +x /usr/local/bin/start-gnucash-session.sh

WORKDIR /workspace

EXPOSE 6080

CMD ["/usr/local/bin/start-gnucash-session.sh"]
