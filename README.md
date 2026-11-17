# Story3D

Type a story, an essay or any short text and watch it play as a 3D or 2D
animation, in a Streamlit app.

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
- **Style** (sidebar): 3D is a lit low-poly world with a moving camera; 2D shows
  the same scenes in flat colours from the side, like a paper cut-out.
- **Creative liberty** (sidebar): *Literal* stages only what the text says.
  *Some* and *Lots* let the app add background life (gulls, a passing boat,
  villagers), set dressing, mood weather and a time of day the text left open.
  It never changes the place, cast or actions you wrote.
- **Reimagine** gives another take on the same text.
- Sidebar also has pace, maximum number of scenes, captions on/off, player height.

## How the text is interpreted

The parser (`story3d/parser.py`) is rule-based and looks words up in
`story3d/lexicon.py`:

| It looks for | Examples | Effect |
| --- | --- | --- |
| Characters | fox, knight, robot, dragon, "Tomas" | actors on stage; capitalised names get a label |
| Vehicles | taxi, train, bicycle, helicopter, ship | drive, sail or fly across the scene |
| Actions | walked, ran, flew, danced, slept, fought | how each actor moves |
| Places | forest, beach, city, desert, mountains, space | the set |
| Time and weather | night, dawn, sunset, rain, storm, snow, fog | sky, light, particles |
| Objects | castle, lighthouse, campfire, piano, mailbox, kite | set pieces behind the cast |
| Mood | happy, afraid, lonely, strange | colour grade and camera |

Place, time, weather and cast carry over from scene to scene, and pronouns
("they slept") bring back the characters last seen. Plural and group words
("townspeople", "villagers", "three dogs") put a group on stage. When a
sentence names two places ("a village by the sea"), the water wins and the
other becomes scenery.

The vocabulary is about 2,100 words covering 114 kinds of character,
animal and vehicle and 78 objects. Vehicles include cars (taxi, police,
ambulance, van, pickup), trucks, buses, a train, bicycles and motorcycles
with riders, tractors, helicopters, ships, rowboats and speedboats. Objects
range from furniture and street fixtures to a ferris wheel, a piano and a
birthday cake. Some words bring set dressing with them: a birthday adds a
cake, balloons and presents; a beach adds a parasol and a sandcastle.

Relationships between things are read too:

- **Riding:** "a dog riding in a car", "the knight rode a horse", "a girl on a
  bicycle", "a wizard flew on a dragon". The rider is seated in or on the
  vehicle or animal and moves with it, and stays aboard in later scenes.
- **Holding:** "a girl carried a basket", "a dog with a bone", "the king held
  a sword". The object goes in the hand (or mouth).
- **Using furniture:** "they sat on a bench", "the king slept in the bed".

- **Eating and drinking:** "the boy ate a hamburger", "the king had a coffee",
  "the family had dinner at the table", "the cow grazed", "the girl fed the
  ducks". People lift food to their mouths and bite (it shrinks bite by bite)
  or sip from a cup; diners sit at the table with a plate each; animals lower
  their heads to food on the ground. About 50 foods and drinks are modelled.
- **Fights:** fighters charge in and stand a lunge apart, measured from their
  actual bodies and weapons, then trade blows: hits, blocks, dodges and
  clashes, with the defender reacting to each one. Knights swing swords,
  giants clubs, wizards cast bolts, dragons bite and breathe fire, and
  unarmed fighters punch and kick. Two against one surround their foe; an
  army against monsters becomes several fights side by side. Sparks and comic
  words ("POW!", "CLANG!") mark where blows land, and the camera keeps both
  sides in frame.

Killing verbs are tracked: "the pirate slew the dragon" ends with the dragon
down, and it stays out of later scenes.

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

board = build_storyboard("At night a fox ran through the forest.", liberty=1)
open("fox.html", "w").write(render_html(board, style="2d"))
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
