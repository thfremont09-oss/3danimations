"""Build the self-contained HTML page that plays a storyboard in 3D."""

from __future__ import annotations

import base64
import json
from functools import lru_cache
from pathlib import Path

STATIC = Path(__file__).parent / "static"


@lru_cache(maxsize=1)
def _shell() -> str:
    """Template with three.js and the viewer script inlined (story left blank)."""
    three = base64.b64encode((STATIC / "three.module.min.js").read_bytes()).decode()
    return (
        (STATIC / "viewer.html").read_text(encoding="utf-8")
        .replace("__VIEWER_JS__", (STATIC / "viewer.js").read_text(encoding="utf-8"))
        .replace("__THREE_URL__", f"data:text/javascript;base64,{three}")
    )


def render_html(storyboard: dict, show_captions: bool = True) -> str:
    """Return a standalone HTML document (no network access needed) for a storyboard."""
    data = {**storyboard, "options": {"captions": show_captions}}
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return _shell().replace("__STORY_JSON__", payload)
