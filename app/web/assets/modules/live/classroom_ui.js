export function createLiveClassroomUi({
  state,
  el,
  escapeHtmlAttr,
  renderList,
  liveParticipantInitials,
  liveParticipantLabel,
  liveRtcState,
  currentLiveUserId,
  pickProviderPeerId,
  pickLastJoinedRemotePeerId,
  streamForPeer,
  setVideoElementStream,
  streamHasActiveVideo,
  setIconButtonLabel,
  liveUiIcon,
  refreshLiveLeaveButton,
  ensureLiveParticipantSelectBinding,
  runHostAction,
  toast,
}) {
  function renderLiveQaList() {
    if (!el.liveRoomQaList) return;
    const rows = Array.isArray(state.liveRoom.qaItems) ? state.liveRoom.qaItems : [];
    if (!rows.length) {
      el.liveRoomQaList.innerHTML = "<div class='item'><span class='meta'>No Q&A items yet.</span></div>";
      return;
    }
    el.liveRoomQaList.innerHTML = rows.map((q, idx) => `
      <div class="item">
        <div class="row between">
          <strong>Q${idx + 1}</strong>
          <span class="meta">${escapeHtmlAttr(q.author || "")}</span>
        </div>
        <div style="margin-top:4px;">${escapeHtmlAttr(q.text || "")}</div>
      </div>
    `).join("");
  }

  function initializeLiveIconButtons() {
    setIconButtonLabel(el.liveRoomToggleToolsBtn, liveUiIcon("tools"), "Tools");
    setIconButtonLabel(el.liveRoomToggleChatBtn, liveUiIcon("chat"), "Chat");
    setIconButtonLabel(el.liveRoomReactBtn, liveUiIcon("reaction"), "Reactions");
    setIconButtonLabel(el.liveRoomFullscreenBtn, liveUiIcon("fullscreen"), "Fullscreen");
    setIconButtonLabel(el.leaveLiveRoomBtn, liveUiIcon("leave"), "Leave");
    refreshLiveLeaveButton();
    if (el.liveRoomParticipantsBtn) {
      el.liveRoomParticipantsBtn.setAttribute("title", "Participants");
      el.liveRoomParticipantsBtn.setAttribute("aria-label", "Participants");
      el.liveRoomParticipantsBtn.dataset.tip = "Participants";
      const pIcon = el.liveRoomParticipantsBtn.querySelector(".ico");
      if (pIcon) pIcon.innerHTML = liveUiIcon("participants");
    }
    if (el.liveRoomStopShareOverlayBtn) el.liveRoomStopShareOverlayBtn.innerHTML = `<span class="ico">${liveUiIcon("stop-share")}</span><span class="lbl">Stop sharing</span>`;
    if (el.liveRoomStartRecordingBtn) el.liveRoomStartRecordingBtn.innerHTML = `<span class="ico">${liveUiIcon("record")}</span>`;
    if (el.liveRoomPauseRecordingBtn) el.liveRoomPauseRecordingBtn.innerHTML = `<span class="ico">${liveUiIcon("pause")}</span>`;
    if (el.liveRoomStopRecordingBtn) el.liveRoomStopRecordingBtn.innerHTML = `<span class="ico">${liveUiIcon("stop")}</span>`;
    if (el.liveRoomOpenWhiteboardBtn) el.liveRoomOpenWhiteboardBtn.querySelector(".ico").innerHTML = liveUiIcon("whiteboard");
    if (el.liveRoomOpenBreakoutBtn) el.liveRoomOpenBreakoutBtn.querySelector(".ico").innerHTML = liveUiIcon("breakout");
    if (el.liveRoomOpenPollBtn) el.liveRoomOpenPollBtn.querySelector(".ico").innerHTML = liveUiIcon("poll");
    if (el.liveRoomOpenQaBtn) el.liveRoomOpenQaBtn.querySelector(".ico").innerHTML = liveUiIcon("qa");
    if (el.liveRoomSendChatBtn) el.liveRoomSendChatBtn.innerHTML = `<span class="ico">${liveUiIcon("send")}</span><span class="lbl">Send</span>`;
  }

  function updateLiveStageAndFocusVideo() {
    const selfId = currentLiveUserId();
    const rtc = liveRtcState();
    const providerPeer = pickProviderPeerId();
    const activePeer = state.liveRoom.focusPeerId || pickLastJoinedRemotePeerId();
    state.liveRoom.focusPeerId = activePeer || "";
    const focusStream = activePeer ? streamForPeer(activePeer) : null;
    if (el.liveRoomFocusTile) el.liveRoomFocusTile.classList.toggle("hidden", !activePeer || !focusStream);
    setVideoElementStream(el.liveRoomFocusVideo, focusStream, { muted: true, mirror: false });
    if (el.liveRoomFocusLabel) el.liveRoomFocusLabel.textContent = activePeer ? liveParticipantLabel(activePeer) : "Active speaker";

    let stageStream = null;
    let stageLabel = "";
    if (state.liveRoom.role === "student") {
      const preferred = providerPeer || activePeer;
      stageStream = preferred ? streamForPeer(preferred) : null;
      stageLabel = preferred ? liveParticipantLabel(preferred) : "Live stage";
    } else {
      stageStream = rtc.localStream || null;
      stageLabel = "You";
    }
    if (!stageStream && activePeer) {
      stageStream = streamForPeer(activePeer);
      stageLabel = liveParticipantLabel(activePeer);
    }
    if (!stageStream && rtc.localStream) {
      stageStream = rtc.localStream;
      stageLabel = selfId ? "You" : "Live stage";
    }
    const sharingScreen = streamHasActiveVideo(rtc.screenStream);
    const showingLocalStage = Boolean(stageStream && stageStream === rtc.localStream);
    if (sharingScreen && showingLocalStage) {
      stageStream = streamHasActiveVideo(rtc.cameraStream) ? rtc.cameraStream : null;
      stageLabel = stageStream ? "You" : "You (sharing screen)";
    }
    const stageHasVideo = streamHasActiveVideo(stageStream);
    const stageRenderStream = stageHasVideo ? stageStream : null;
    const isLocalStage = Boolean(stageRenderStream && stageRenderStream === rtc.localStream);
    setVideoElementStream(el.liveRoomStageVideo, stageRenderStream, { muted: isLocalStage, mirror: isLocalStage });
    if (el.liveRoomStagePlaceholder) el.liveRoomStagePlaceholder.classList.toggle("hidden", Boolean(stageRenderStream));
    if (el.liveRoomMeta) {
      const base = el.liveRoomMeta.textContent || "";
      if (stageLabel) {
        const noSpeaker = base.replace(/\s\|\sSpeaker:.*$/i, "");
        el.liveRoomMeta.textContent = `${noSpeaker} | Speaker: ${stageLabel}`;
      }
    }
  }

  function renderLiveRemoteVideos() {
    if (!el.liveRoomRemoteVideoGrid) return;
    const rtc = liveRtcState();
    const entries = Object.entries(rtc.remoteStreams || {});
    if (!entries.length) {
      el.liveRoomRemoteVideoGrid.innerHTML = "<div class='item'><span class='meta'>Waiting for participants to turn on video.</span></div>";
      return;
    }
    const html = entries.map(([peerId]) => `
      <div class="live-video-tile" data-live-remote-peer="${escapeHtmlAttr(peerId)}">
        <video autoplay playsinline class="live-video-el"></video>
        <div class="live-video-label">${escapeHtmlAttr(liveParticipantLabel(peerId))}</div>
      </div>
    `).join("");
    el.liveRoomRemoteVideoGrid.innerHTML = html;
    entries.forEach(([peerId, stream]) => {
      const video = el.liveRoomRemoteVideoGrid.querySelector(`[data-live-remote-peer="${peerId}"] video`);
      if (!video) return;
      setVideoElementStream(video, stream, { muted: true, mirror: false });
    });
    updateLiveStageAndFocusVideo();
  }

  function renderLiveRoomParticipants(room) {
    const participants = room?.participants || [];
    state.liveRoom.participantMap = {};
    participants.forEach((p) => {
      state.liveRoom.participantMap[String(Number(p.user_id || 0))] = p;
    });
    const isProvider = state.liveRoom.role === "provider";
    renderList(
      el.liveRoomParticipantsList,
      participants,
      (p) => `
        <div class="live-participant-row row between" data-live-participant-id="${Number(p.user_id || 0)}">
          <span class="live-participant-main">
            <span class="live-participant-avatar">${escapeHtmlAttr(liveParticipantInitials(p.display_name || "User"))}</span>
            <span class="live-participant-copy">
              <strong>${escapeHtmlAttr(p.display_name || "User")}${p.raised_hand ? " <span class='live-hand-indicator' aria-label='Raised hand' title='Raised hand'>✋</span>" : ""}</strong>
              <span class="meta">${escapeHtmlAttr(p.actor_role || "participant")}</span>
            </span>
          </span>
          <span class="actions">
            <span class='meta'>Active</span>
            ${isProvider && p.actor_role !== "provider" ? `<button class="btn small" title="Mute ${escapeHtmlAttr(p.display_name || "user")}" data-live-mute="${Number(p.user_id || 0)}">Mute</button><button class="btn small danger" title="Remove ${escapeHtmlAttr(p.display_name || "user")}" data-live-remove="${Number(p.user_id || 0)}">Remove</button>` : ""}
          </span>
        </div>
      `,
      "No active participants.",
    );
    renderList(
      el.liveRoomHandsList,
      participants.filter((p) => p.raised_hand),
      (p) => `<div><strong>${escapeHtmlAttr(p.display_name || "User")}</strong> <span class="meta">(${escapeHtmlAttr(p.actor_role || "participant")})</span></div>`,
      "No raised hands.",
    );
    ensureLiveParticipantSelectBinding();
    document.querySelectorAll("[data-live-mute]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = Number(btn.getAttribute("data-live-mute") || 0);
        if (!uid) return;
        runHostAction("mute", { target_user_id: uid }).catch((err) => toast(err?.message || "Mute failed", "error"));
      });
    });
    document.querySelectorAll("[data-live-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = Number(btn.getAttribute("data-live-remove") || 0);
        if (!uid) return;
        runHostAction("remove", { target_user_id: uid }).catch((err) => toast(err?.message || "Remove failed", "error"));
      });
    });
    renderLiveRemoteVideos();
  }

  return {
    renderLiveQaList,
    initializeLiveIconButtons,
    updateLiveStageAndFocusVideo,
    renderLiveRemoteVideos,
    renderLiveRoomParticipants,
  };
}
