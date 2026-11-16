"""Story3D: type a story, essay or short text and watch it as a 3D animation.

Run with:  streamlit run app.py
"""

from __future__ import annotations

import json

import streamlit as st

from story3d import build_storyboard, render_html

EXAMPLES = {
    "The fox and the lighthouse": (
        "At dawn a young fox walked along the beach. A fisherman named Tomas sat "
        "beside his boat and watched the sea. Suddenly a storm rolled in and the "
        "fox ran toward the lighthouse. Tomas followed, shouting into the rain. "
        "That night they slept beside a small fire while the moon rose over the "
        "island. In the morning two birds flew over the calm ocean, and the fox "
        "danced on the sand."
    ),
    "The robot in the city": (
        "A small robot wandered through the city at night. Cars rushed along the "
        "street and nobody noticed it. In a quiet park it found a lost dog. The "
        "robot and the dog walked together until sunrise. A girl ran toward them, "
        "laughing, and the dog jumped with joy."
    ),
    "Knight and dragon": (
        "Long ago a brave knight rode a horse into the mountains. A red dragon "
        "flew above the castle and roared. The knight fought the dragon in the "
        "snow. At sunset the dragon fell asleep beside a chest of gold, and the "
        "knight walked home through the forest."
    ),
    "Essay: on attention": (
        "Attention is the rarest form of generosity. Most of what we call "
        "productivity is merely motion without direction. Technology promises "
        "connection, yet it often delivers distraction instead. Meaningful work "
        "requires patience, silence, and an unreasonable amount of focus. "
        "Perhaps wisdom begins when we decide what deserves to be ignored."
    ),
}

st.set_page_config(page_title="Story3D", page_icon="🎬", layout="wide")
st.title("Story3D")
st.caption("Turn a story, essay or short text into a 3D or 2D animation.")

with st.sidebar:
    st.header("Settings")
    example = st.selectbox("Start from an example", ["(my own text)", *EXAMPLES])
    style = st.radio("Style", ["3D", "2D"], horizontal=True,
                     help="3D: lit low-poly world with a moving camera. "
                          "2D: flat colours seen side-on, like a paper cut-out.")
    liberty_name = st.select_slider(
        "Creative liberty", ["Literal", "Some", "Lots"], value="Some",
        help="Literal stages only what the text says. Higher settings add "
             "background life, set dressing, weather and a time of day of the app's choosing.")
    liberty = ["Literal", "Some", "Lots"].index(liberty_name)
    pace = st.slider("Pace (seconds per scene)", 0.5, 2.0, 1.0, 0.1,
                     help="Higher is slower: 2.0 doubles every scene's length.")
    max_scenes = st.slider("Maximum scenes", 3, 24, 12,
                           help="Longer texts are grouped into at most this many shots.")
    captions = st.toggle("Show captions", value=True)
    height = st.slider("Player height (px)", 360, 900, 560, 20)

if st.session_state.get("example") != example:
    st.session_state["example"] = example
    if example in EXAMPLES:
        st.session_state["text"] = EXAMPLES[example]

text = st.text_area(
    "Your text",
    key="text",
    height=170,
    placeholder="Once upon a time a fox walked through the forest at night…",
)

make, again, _ = st.columns([1, 1, 3])
if make.button("Create animation", type="primary", disabled=not text.strip()):
    st.session_state["source"] = text
    st.session_state["take"] = 0
if again.button("Reimagine", disabled=not liberty or not st.session_state.get("source"),
                help="Another take on the same text (needs some creative liberty)."):
    st.session_state["take"] = st.session_state.get("take", 0) + 1

source = st.session_state.get("source")
if not source:
    st.info("Write or paste some text, then press **Create animation**. "
            "Concrete words (characters, animals, places, weather, time of day, "
            "actions) become scenes; abstract passages become motion graphics.")
    st.stop()

board = build_storyboard(source, max_scenes=max_scenes, pace=pace, liberty=liberty,
                         variation=st.session_state.get("take", 0))
if not board["scenes"]:
    st.warning("There is no text to animate.")
    st.stop()

html = render_html(board, show_captions=captions, style=style.lower())
if hasattr(st, "iframe"):
    st.iframe(html, height=height)
else:  # Streamlit < 1.56
    import streamlit.components.v1 as components

    components.html(html, height=height, scrolling=False)

left, mid, right = st.columns([1, 1, 2])
left.download_button("Download as standalone HTML", html, "story3d.html", "text/html",
                     help="A single file that plays offline in any modern browser.")
mid.download_button("Download storyboard (JSON)", json.dumps(board, indent=2),
                    "storyboard.json", "application/json")
right.caption(f"{len(board['scenes'])} scenes · {board['duration']:.0f} s · "
              "use **Record** in the player to save a video.")

with st.expander("Storyboard: how the text was interpreted"):
    st.dataframe(
        [
            {
                "#": i + 1,
                "Text": s["text"],
                "Place": "abstract" if s["abstract"] else s["setting"],
                "Time": s["time"],
                "Weather": s["weather"],
                "Mood": s["mood"],
                "Cast": ", ".join(
                    f"{a['name'] or a['kind']}"
                    f"{' ×' + str(a['count']) if a['count'] > 1 else ''} ({a['action']})"
                    for a in s["actors"] if not a["ambient"]) or "—",
                "Added by the app": ", ".join(
                    f"{a['kind']}{' ×' + str(a['count']) if a['count'] > 1 else ''}"
                    for a in s["actors"] if a["ambient"]) or "—",
                "Props": ", ".join(p["kind"] for p in s["props"]) or "—",
                "Seconds": s["duration"],
            }
            for i, s in enumerate(board["scenes"])
        ],
        hide_index=True,
    )
