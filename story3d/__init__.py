"""Story3D: turn a story, essay or short text into a 3D animation."""

from .parser import build_storyboard
from .viewer import render_html

__all__ = ["build_storyboard", "render_html"]
