import json
import random
import threading
import time
from collections import defaultdict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.entities import Course, Enrollment, LiveClassSession, ProviderProfile, User, UserRole
from app.services.firebase_auth import verify_firebase_token


class LiveSignalManager:
    def __init__(self) -> None:
        self._rooms: dict[int, dict[int, set[WebSocket]]] = defaultdict(lambda: defaultdict(set))
        self._state: dict[int, dict] = defaultdict(self._new_session_state)
        self._lock = threading.RLock()

    @staticmethod
    def _new_session_state() -> dict:
        return {
            "waiting_room_enabled": True,
            "admitted_users": set(),
            "waiting_users": {},  # user_id -> {"display_name": str, "role": str, "joined_at": ms}
            "removed_users": set(),
            "muted_users": set(),
            "breakouts": {},  # user_id -> room label
        }

    def connect(self, session_id: int, user_id: int, websocket: WebSocket) -> None:
        with self._lock:
            self._rooms[session_id][user_id].add(websocket)

    def disconnect(self, session_id: int, user_id: int, websocket: WebSocket) -> None:
        with self._lock:
            room = self._rooms.get(session_id)
            if not room:
                return
            sockets = room.get(user_id)
            if sockets and websocket in sockets:
                sockets.remove(websocket)
            if sockets is not None and not sockets:
                room.pop(user_id, None)
            if not room:
                self._rooms.pop(session_id, None)

    async def emit(
        self,
        session_id: int,
        payload: dict,
        *,
        to_user_id: int | None = None,
        exclude_user_id: int | None = None,
    ) -> None:
        with self._lock:
            room = self._rooms.get(session_id, {})
            if to_user_id:
                targets = [(to_user_id, list(room.get(to_user_id, set())))]
            else:
                targets = [(uid, list(socks)) for uid, socks in room.items()]
        for uid, sockets in targets:
            if exclude_user_id and uid == exclude_user_id:
                continue
            for ws in sockets:
                try:
                    await ws.send_json(payload)
                except Exception:
                    self.disconnect(session_id, uid, ws)

    def _ensure_provider_admitted(self, session_id: int, user_id: int, role: str) -> None:
        st = self._state[session_id]
        if role == UserRole.PROVIDER.value:
            st["admitted_users"].add(int(user_id))

    def register_join_intent(self, session_id: int, user_id: int, role: str, display_name: str) -> str:
        uid = int(user_id)
        role_v = str(role or "").lower()
        st = self._state[session_id]
        self._ensure_provider_admitted(session_id, uid, role_v)
        if uid in st["removed_users"]:
            return "blocked"
        if role_v == UserRole.PROVIDER.value:
            st["waiting_users"].pop(uid, None)
            return "admitted"
        if uid in st["admitted_users"]:
            st["waiting_users"].pop(uid, None)
            return "admitted"
        if not st["waiting_room_enabled"]:
            st["admitted_users"].add(uid)
            st["waiting_users"].pop(uid, None)
            return "admitted"
        st["waiting_users"][uid] = {
            "display_name": display_name or f"User {uid}",
            "role": role_v or UserRole.STUDENT.value,
            "joined_at": int(time.time() * 1000),
        }
        return "waiting"

    def set_waiting_room_enabled(self, session_id: int, enabled: bool) -> bool:
        st = self._state[session_id]
        st["waiting_room_enabled"] = bool(enabled)
        if not enabled:
            for uid in list(st["waiting_users"].keys()):
                st["admitted_users"].add(int(uid))
            st["waiting_users"] = {}
        return bool(st["waiting_room_enabled"])

    def can_participate(self, session_id: int, user_id: int, role: str) -> bool:
        uid = int(user_id)
        st = self._state[session_id]
        if uid in st["removed_users"]:
            return False
        if str(role or "").lower() == UserRole.PROVIDER.value:
            return True
        return uid in st["admitted_users"]

    def get_access_status(self, session_id: int, user_id: int, role: str, display_name: str) -> str:
        return self.register_join_intent(session_id, user_id, role, display_name)

    def admit_user(self, session_id: int, user_id: int) -> None:
        uid = int(user_id)
        st = self._state[session_id]
        st["removed_users"].discard(uid)
        st["admitted_users"].add(uid)
        st["waiting_users"].pop(uid, None)

    def reject_user(self, session_id: int, user_id: int) -> None:
        uid = int(user_id)
        st = self._state[session_id]
        st["waiting_users"].pop(uid, None)
        st["admitted_users"].discard(uid)
        st["removed_users"].add(uid)
        st["breakouts"].pop(uid, None)
        st["muted_users"].discard(uid)

    def remove_user(self, session_id: int, user_id: int) -> None:
        self.reject_user(session_id, user_id)

    def mute_user(self, session_id: int, user_id: int, muted: bool) -> None:
        uid = int(user_id)
        st = self._state[session_id]
        if muted:
            st["muted_users"].add(uid)
        else:
            st["muted_users"].discard(uid)

    def assign_breakout(self, session_id: int, user_id: int, room: str | None) -> None:
        uid = int(user_id)
        st = self._state[session_id]
        if not room:
            st["breakouts"].pop(uid, None)
        else:
            st["breakouts"][uid] = str(room).strip()[:120]

    def clear_breakouts(self, session_id: int) -> None:
        self._state[session_id]["breakouts"] = {}

    def user_flags(self, session_id: int, user_id: int) -> dict:
        uid = int(user_id)
        st = self._state[session_id]
        return {
            "muted": uid in st["muted_users"],
            "removed": uid in st["removed_users"],
            "breakout_room": st["breakouts"].get(uid),
        }

    def moderation_snapshot(self, session_id: int) -> dict:
        st = self._state[session_id]
        waiting_items = [
            {"user_id": int(uid), **meta}
            for uid, meta in sorted(st["waiting_users"].items(), key=lambda kv: kv[1].get("joined_at", 0))
        ]
        return {
            "waiting_room_enabled": bool(st["waiting_room_enabled"]),
            "waiting_users": waiting_items,
            "admitted_user_ids": sorted(int(x) for x in st["admitted_users"]),
            "muted_user_ids": sorted(int(x) for x in st["muted_users"]),
            "removed_user_ids": sorted(int(x) for x in st["removed_users"]),
            "breakouts": {str(int(uid)): room for uid, room in st["breakouts"].items()},
        }


signal_manager = LiveSignalManager()


def _ws_close_payload(code: int, reason: str) -> tuple[int, str]:
    return code, reason[:120]


def _resolve_user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    try:
        claims = verify_firebase_token(token)
    except Exception:
        return None
    email = str(claims.get("email") or "").strip().lower()
    if not email:
        return None
    return db.scalar(select(User).where(func.lower(func.trim(User.email)) == email))


def _provider_allowed(db: Session, user_id: int, session_id: int) -> bool:
    provider_id = db.scalar(select(ProviderProfile.id).where(ProviderProfile.user_id == user_id))
    if not provider_id:
        return False
    session = db.scalar(select(LiveClassSession).where(LiveClassSession.id == session_id))
    if not session:
        return False
    return int(session.provider_id or 0) == int(provider_id)


def _student_allowed(db: Session, user_id: int, session_id: int) -> bool:
    row = db.execute(
        select(LiveClassSession, Course, Enrollment)
        .join(Course, Course.id == LiveClassSession.course_id)
        .join(Enrollment, and_(Enrollment.course_id == Course.id, Enrollment.student_id == user_id))
        .where(LiveClassSession.id == session_id),
    ).first()
    return bool(row)


def _is_authorized_for_session(db: Session, user: User, session_id: int) -> bool:
    if user.role == UserRole.PROVIDER:
        return _provider_allowed(db, user.id, session_id)
    if user.role == UserRole.STUDENT:
        return _student_allowed(db, user.id, session_id)
    return False


def _safe_int(value, default: int | None = None) -> int | None:
    try:
        return int(value)
    except Exception:
        return default


def register_live_websocket(app: FastAPI) -> None:
    @app.websocket("/ws/live/{session_id}")
    async def live_signal_socket(websocket: WebSocket, session_id: int):
        token = websocket.query_params.get("token")
        db: Session = SessionLocal()
        user: User | None = None
        try:
            user = _resolve_user_from_token(db, token)
            if not user:
                await websocket.close(*_ws_close_payload(4401, "Unauthorized"))
                return
            if not _is_authorized_for_session(db, user, session_id):
                await websocket.close(*_ws_close_payload(4403, "Forbidden"))
                return
            role = user.role.value
            display_name = user.full_name or user.email
            access = signal_manager.register_join_intent(session_id, user.id, role, display_name)
            await websocket.accept()
            signal_manager.connect(session_id, user.id, websocket)
            await websocket.send_json(
                {
                    "type": "room_access",
                    "status": access,
                    "flags": signal_manager.user_flags(session_id, user.id),
                    "moderation": signal_manager.moderation_snapshot(session_id) if role == UserRole.PROVIDER.value else None,
                    "ts": int(time.time() * 1000),
                },
            )
            await signal_manager.emit(
                session_id,
                {
                    "type": "presence",
                    "event": "joined",
                    "user_id": user.id,
                    "ts": int(time.time() * 1000),
                },
                exclude_user_id=user.id,
            )
            while True:
                packet_raw = await websocket.receive_text()
                try:
                    packet = json.loads(packet_raw or "{}")
                except Exception:
                    continue
                ptype = str(packet.get("type") or "").strip().lower()
                if ptype == "ping":
                    await websocket.send_json({"type": "pong", "ts": int(time.time() * 1000)})
                    continue
                if ptype == "host_action" and role == UserRole.PROVIDER.value:
                    action = str(packet.get("action") or "").strip().lower()
                    target_user_id = _safe_int(packet.get("target_user_id"))
                    if action == "toggle_waiting_room":
                        enabled = bool(packet.get("enabled", True))
                        signal_manager.set_waiting_room_enabled(session_id, enabled)
                    elif action == "admit" and target_user_id:
                        signal_manager.admit_user(session_id, target_user_id)
                        await signal_manager.emit(
                            session_id,
                            {
                                "type": "room_access",
                                "status": "admitted",
                                "flags": signal_manager.user_flags(session_id, target_user_id),
                                "ts": int(time.time() * 1000),
                            },
                            to_user_id=target_user_id,
                        )
                    elif action in {"reject", "remove"} and target_user_id:
                        signal_manager.remove_user(session_id, target_user_id)
                        await signal_manager.emit(
                            session_id,
                            {
                                "type": "room_access",
                                "status": "blocked",
                                "flags": signal_manager.user_flags(session_id, target_user_id),
                                "ts": int(time.time() * 1000),
                            },
                            to_user_id=target_user_id,
                        )
                    elif action in {"mute", "unmute"} and target_user_id:
                        signal_manager.mute_user(session_id, target_user_id, action == "mute")
                        await signal_manager.emit(
                            session_id,
                            {
                                "type": "room_flags",
                                "flags": signal_manager.user_flags(session_id, target_user_id),
                                "ts": int(time.time() * 1000),
                            },
                            to_user_id=target_user_id,
                        )
                    elif action == "assign_breakout" and target_user_id:
                        room = str(packet.get("room") or "").strip() or None
                        signal_manager.assign_breakout(session_id, target_user_id, room)
                        await signal_manager.emit(
                            session_id,
                            {
                                "type": "room_flags",
                                "flags": signal_manager.user_flags(session_id, target_user_id),
                                "ts": int(time.time() * 1000),
                            },
                            to_user_id=target_user_id,
                        )
                    elif action == "clear_breakouts":
                        signal_manager.clear_breakouts(session_id)
                    await signal_manager.emit(
                        session_id,
                        {
                            "type": "moderation",
                            "state": signal_manager.moderation_snapshot(session_id),
                            "ts": int(time.time() * 1000),
                        },
                    )
                    continue
                if ptype != "signal":
                    continue
                if not signal_manager.can_participate(session_id, user.id, role):
                    continue
                kind = str(packet.get("kind") or "").strip().lower()
                if kind not in {"presence", "offer", "answer", "ice", "leave"}:
                    continue
                to_user_id_raw = packet.get("to_user_id")
                to_user_id = _safe_int(to_user_id_raw)
                payload = packet.get("payload") if isinstance(packet.get("payload"), dict) else {}
                out = {
                    "type": "signal",
                    "id": f"{session_id}-{user.id}-{int(time.time() * 1000)}-{random.randint(1000, 9999)}",
                    "kind": kind,
                    "from_user_id": user.id,
                    "to_user_id": to_user_id,
                    "payload": payload,
                    "ts": int(time.time() * 1000),
                }
                await signal_manager.emit(
                    session_id,
                    out,
                    to_user_id=to_user_id,
                    exclude_user_id=None if to_user_id else user.id,
                )
        except WebSocketDisconnect:
            pass
        finally:
            if user:
                signal_manager.disconnect(session_id, user.id, websocket)
                await signal_manager.emit(
                    session_id,
                    {
                        "type": "presence",
                        "event": "left",
                        "user_id": user.id,
                        "ts": int(time.time() * 1000),
                    },
                    exclude_user_id=user.id,
                )
            db.close()
