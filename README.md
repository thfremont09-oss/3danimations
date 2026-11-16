# Story3D

Type a story, an essay or any short text and watch it play as a 3D animation,
in a Streamlit app.

The text is split into scenes. Each scene is staged with low-poly characters,
animals, vehicles, props, a place, a time of day, weather and a camera move.
Passages with nothing concrete to show (most essays) become motion graphics
built around the passage's key words.

Everything runs locally: no API keys, no network calls. three.js is bundled
in the repository.

## Run it

```bash
pip install -r requirements.txt
```

```bash
streamlit run app.py
```

Then open the URL Streamlit prints (http://localhost:8501 by default), pick an
example or paste your own text, and press **Create animation**.

## What you can do

- **Play, pause, scrub** the timeline; space toggles play. Fullscreen is in the player.
- **Record** plays the animation from the start and saves a video (WebM in
  most browsers) with captions burned in. Recording is real-time.
- **Download as standalone HTML** gives one file that plays offline anywhere.
- **Storyboard** (expander under the player) shows how each sentence was read:
  place, time, weather, mood, cast and actions.
- Sidebar: pace, maximum number of scenes, captions on/off, player height.

## How the text is interpreted

The parser (`story3d/parser.py`) is rule-based and looks words up in
`story3d/lexicon.py`:

| It looks for | Examples | Effect |
| --- | --- | --- |
| Characters | fox, knight, robot, dragon, "Tomas" | actors on stage; capitalised names get a label |
| Actions | walked, ran, flew, danced, slept, fought | how each actor moves |
| Places | forest, beach, city, desert, mountains, space | the set |
| Time and weather | night, dawn, sunset, rain, storm, snow, fog | sky, light, particles |
| Props | castle, lighthouse, campfire, treasure, lantern | set pieces behind the cast |
| Mood | happy, afraid, lonely, strange | colour grade and camera |

Place, time, weather and cast carry over from scene to scene, and pronouns
("they slept") bring back the characters last seen.

It is a keyword reader, not a language model, so it only stages words it
knows. To teach it more, add words to the tables in `story3d/lexicon.py`; new
looks can reuse the base builders in `story3d/static/viewer.js`.

## Project layout

```
app.py                      Streamlit UI
story3d/parser.py           text -> storyboard (plain dict / JSON)
story3d/lexicon.py          vocabulary and model definitions
story3d/viewer.py           storyboard -> self-contained HTML
story3d/static/viewer.js    three.js player: sets, actors, camera, recording
story3d/static/viewer.html  page shell
tests/                      parser tests
```

Use it without Streamlit:

```python
from story3d import build_storyboard, render_html

board = build_storyboard("At night a fox ran through the forest.")
open("fox.html", "w").write(render_html(board))
```

## Tests

```bash
pip install -r requirements-dev.txt
```

```bash
pytest
```

three.js (r160) is included under the MIT license, see
`story3d/static/THREE_LICENSE`.
