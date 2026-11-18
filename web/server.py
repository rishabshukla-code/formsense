"""Serve the browser client and hand out LiveKit tokens that dispatch the agent.

Each visit gets its own room. The token tells LiveKit to dispatch the agent
(AGENT_NAME, default "parallel-search-agent") into that room as soon as the
browser joins, so no `lk dispatch` command is needed.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv
from livekit import api

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7880")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")
AGENT_NAME = os.environ.get("AGENT_NAME", "parallel-search-agent")
PORT = int(os.environ.get("WEB_PORT", "3000"))
STATIC = Path(__file__).resolve().parent / "static"


async def token(_: web.Request) -> web.Response:
    room = f"web-{uuid.uuid4().hex[:8]}"
    identity = f"user-{uuid.uuid4().hex[:6]}"
    jwt = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name("You")
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .with_room_config(
            api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=AGENT_NAME)])
        )
        .to_jwt()
    )
    return web.json_response({"url": LIVEKIT_URL, "token": jwt, "room": room})


async def index(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC / "index.html")


async def practice(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC / "practice.html")


def make_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/practice", practice)
    app.router.add_get("/api/token", token)
    app.router.add_static("/static", STATIC)
    # Preview the Chrome extension's side panel as a normal page while developing.
    app.router.add_static("/extension", ROOT / "extension")
    return app


if __name__ == "__main__":
    print(f"Web app on http://localhost:{PORT}  (LiveKit {LIVEKIT_URL}, agent {AGENT_NAME})")
    web.run_app(make_app(), host="127.0.0.1", port=PORT, print=None)
