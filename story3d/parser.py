"""Turn free text into a storyboard: a list of scenes the 3D viewer can stage.

The parser is deliberately rule-based so the app runs offline with no API key.
It splits the text into scenes, then for each scene looks up words in the
lexicon to decide who is on stage, what they are doing, where and when it
happens, the weather and the mood. World state (place, time of day, weather,
cast) carries over between scenes the way it does for a reader.
"""

from __future__ import annotations

import re
import zlib
from collections import Counter

from . import lexicon as L

_SENT_SPLIT = re.compile(r"(?<=[.!?…][\"'”’)\]])\s+|(?<=[.!?…])\s+|\n+")
_TOKEN = re.compile(r"[A-Za-z][A-Za-z'’-]*")
_QUOTES = "\"“‘'"
_PLURAL_SUFFIXES = (("ies", "y"), ("ves", "f"), ("es", ""), ("s", ""))
_VERB_SUFFIXES = ("ing", "ed", "d")


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT_SPLIT.split(text.strip()) if p and p.strip()]
    merged: list[str] = []
    for part in parts:
        # Glue fragments ("Mr.", "Oh!") onto their neighbour.
        if merged and len(merged[-1].split()) < 3:
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    if len(merged) > 1 and len(merged[-1].split()) < 3:
        tail = merged.pop()
        merged[-1] = f"{merged[-1]} {tail}"
    return merged


def _candidates(word: str):
    """Yield (stem, is_plural) guesses for a lowercase word, best first."""
    yield word, word in L.IRREGULAR_PLURALS
    if word in L.IRREGULAR:
        yield L.IRREGULAR[word], word in L.IRREGULAR_PLURALS
    for suffix, repl in _PLURAL_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            yield word[: -len(suffix)] + repl, True
    for suffix in _VERB_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            stem = word[: -len(suffix)]
            yield stem + "e", False
            if len(stem) > 2 and stem[-1] == stem[-2]:
                yield stem[:-1], False
            yield stem, False


def _find(word: str, table: dict):
    """Look a word up in a lexicon table. Returns (value, is_plural) or None."""
    if word in L.IGNORE:
        return None
    for stem, plural in _candidates(word):
        if stem in table:
            return table[stem], plural
    return None


def _known(word: str) -> bool:
    return any(
        _find(word, t)
        for t in (L.ACTOR_WORDS, L.PROP_WORDS, L.SETTING_WORDS, L.TIME_WORDS,
                  L.WEATHER_WORDS, L.ACTION_WORDS, L.MOOD_WORDS, L.COLLECTIVES)
    )


def _tokens(sentence: str) -> list[tuple[str, bool]]:
    """[(word, follows_a_quote_mark)]"""
    out = []
    for m in _TOKEN.finditer(sentence):
        quoted = m.start() > 0 and sentence[m.start() - 1] in _QUOTES
        out.append((m.group().replace("’", "'"), quoted))
    return out


def find_names(sentences: list[str]) -> set[str]:
    """Guess character names: capitalised words that are not ordinary vocabulary."""
    mid, start, after_place = Counter(), Counter(), Counter()
    for sentence in sentences:
        toks = _tokens(sentence)
        for i, (word, quoted) in enumerate(toks):
            base = word.split("'")[0]
            low = base.lower()
            if (len(base) < 3 or not base[0].isupper() or base.isupper()
                    or low in L.STOPWORDS or _known(low)):
                continue
            if i == 0 or quoted:
                start[base] += 1
            else:
                mid[base] += 1
                if toks[i - 1][0].lower() in L.PLACE_PREPS:
                    after_place[base] += 1
    names = set()
    for name in set(mid) | set(start):
        if mid[name] and after_place[name] == mid[name] and not start[name]:
            continue  # only ever "in Paris" / "to Rome": a place, not a person
        if mid[name] >= 1 or start[name] >= 2:
            names.add(name)
    return names


def _chunk(sentences: list[str], max_scenes: int) -> list[list[str]]:
    n = len(sentences)
    if n <= max_scenes:
        return [[s] for s in sentences]
    return [
        sentences[round(i * n / max_scenes): round((i + 1) * n / max_scenes)]
        for i in range(max_scenes)
    ]


def _keywords(words: list[str], limit: int = 4) -> list[str]:
    seen, out = set(), []
    for w in sorted(words, key=len, reverse=True):
        lw = w.lower()
        if len(lw) > 3 and lw not in L.STOPWORDS and lw not in seen and "'" not in lw \
                and not lw.endswith("ly"):
            seen.add(lw)
            out.append(lw)
        if len(out) == limit:
            break
    return out


def _pick_action(pos: int, actions: list[tuple[int, str]], default: str) -> str:
    after = [a for p, a in actions if p > pos]
    if after:
        return after[0]
    before = [a for p, a in actions if p < pos]
    return before[-1] if before else default


class _World:
    """State that carries over from one scene to the next."""

    def __init__(self) -> None:
        self.setting: str | None = None
        self.setting_explicit = False
        self.time = "day"
        self.weather = "clear"
        self.cast: list[dict] = []   # recently seen actors, newest first
        self.last_size = 0           # how many of them were in the latest scene
        self.name_kind: dict[str, str] = {}
        self.last_concrete = -99


def _parse_scene(idx: int, captions: list[str], names: set[str], world: _World) -> dict:
    toks = [t for c in captions for t in _tokens(c)]
    words = [w for w, _ in toks]
    lows = [w.lower() for w in words]

    actors: dict[str, dict] = {}
    props: list[str] = []
    actions: list[tuple[int, str]] = []
    settings, times, weathers, moods = [], [], [], Counter()

    def add_actor(kind: str, pos: int, count: int = 1, name: str | None = None) -> dict:
        key = f"{kind}:{name}" if name else kind
        actor = actors.get(key)
        if actor is None:
            actor = actors[key] = {"id": key, "kind": kind, "name": name,
                                   "count": count, "pos": pos}
        else:
            actor["count"] = max(actor["count"], count)
        return actor

    last_actor: tuple[int, dict] | None = None
    for i, low in enumerate(lows):
        base = words[i].split("'")[0]
        if base in names:
            # "King Arthur" / "the wizard Merlin": the name belongs to that actor.
            gap = lows[last_actor[0] + 1: i] if last_actor else None
            if last_actor and not last_actor[1]["name"] and (
                    gap == [] or gap in (["named"], ["called"])):
                prev = last_actor[1]
                del actors[prev["id"]]
                world.name_kind[base] = prev["kind"]
                last_actor = (i, add_actor(prev["kind"], prev["pos"], 1, base))
            else:
                kind = world.name_kind.setdefault(base, "person")
                last_actor = (i, add_actor(kind, i, 1, base))
            continue
        low = low.split("'")[0]

        if low in L.COLLECTIVES:
            kind, count = L.COLLECTIVES[low]
            last_actor = (i, add_actor(kind, i, count))
        elif hit := _find(low, L.ACTOR_WORDS):
            kind, plural = hit
            count = 3 if plural else 1
            for back in lows[max(0, i - 2): i]:
                count = L.NUMBERS.get(back, count)
            last_actor = (i, add_actor(kind, i, count))
        elif hit := _find(low, L.PROP_WORDS):
            if hit[0] not in props:
                props.append(hit[0])

        if hit := _find(low, L.SETTING_WORDS):
            settings.append(hit[0])
        if hit := _find(low, L.TIME_WORDS):
            times.append(hit[0])
        if hit := _find(low, L.WEATHER_WORDS):
            weathers.append(hit[0])
        if hit := _find(low, L.ACTION_WORDS):
            asleep = hit[0] == "fall" and lows[i + 1: i + 2] == ["asleep"]
            actions.append((i, "sleep" if asleep else hit[0]))
        if hit := _find(low, L.MOOD_WORDS):
            moods[hit[0]] += 1

    # ---- who is on stage -------------------------------------------------
    def act_for(kind: str, pos: int) -> str:
        model = L.MODELS[kind]
        action = _pick_action(pos, actions, model.get("default", "idle"))
        if model["base"] in L.VEHICLES and action not in ("walk", "run", "fly"):
            return "idle"
        return action

    cast: list[dict] = []
    for actor in actors.values():
        actor["action"] = act_for(actor["kind"], actor["pos"])
        cast.append(actor)

    low_set = set(lows)
    physical = [a for _, a in actions if a in L.PHYSICAL_ACTIONS]
    action_at = {p for p, _ in actions}
    # "it" only counts as a character when it does something ("it found", not "it was")
    subjects = [i for i, w in enumerate(lows)
                if w in L.SUBJECT_PRONOUNS or (w == "it" and i + 1 in action_at)]
    plural = bool(low_set & {"they", "them", "their", "theirs"})
    if plural:
        recalled = world.cast[: max(world.last_size, 2)]
    else:  # he / she / it: prefer a single character over a group
        latest = world.cast[: world.last_size]
        recalled = ([a for a in latest if a["count"] == 1]
                    or [a for a in world.cast if a["count"] == 1][:1] or latest)
    if not cast:
        if recalled and (low_set & L.PRONOUNS or subjects or physical):
            for prev in recalled:
                cast.append({**prev, "action": act_for(prev["kind"], -1)})
        elif low_set & L.FIRST_PERSON and physical:
            count = 2 if low_set & {"we", "us", "our"} else 1
            cast.append({"id": "person:narrator", "kind": "person", "name": None,
                         "count": count, "action": physical[0]})
    elif world.cast:
        first = min(a["pos"] for a in cast)
        lead = [i for i in subjects if i < first]
        if lead:
            present = {a["id"] for a in cast}
            extra = [p for p in recalled if p["id"] not in present][:2]
            for prev in extra:
                cast.insert(0, {**prev, "action": act_for(prev["kind"], lead[0])})

    # ---- where and when --------------------------------------------------
    models = [L.MODELS[a["kind"]] for a in cast]
    implied = next((m["implies"] for m in models if "implies" in m), None)
    implied = implied or next(
        (L.PROPS[p]["implies"] for p in props if "implies" in L.PROPS[p]), None)
    needs_water = any(m.get("water") for m in models) or any(
        a["action"] == "swim" for a in cast)

    previous_setting = world.setting
    if settings:
        world.setting = Counter(settings).most_common(1)[0][0]
        world.setting_explicit = True
    elif implied and not world.setting_explicit:
        world.setting = implied
    if needs_water and world.setting not in L.WATER_SETTINGS:
        world.setting = implied if implied in L.WATER_SETTINGS else "lake"

    new_time = bool(times) and times[0] != world.time
    if times:
        world.time = times[0]
    if weathers:
        world.weather = weathers[-1]
    elif new_time or (world.setting != previous_setting and previous_setting is not None):
        world.weather = "clear"  # a new place or time of day clears old weather
    if world.setting == "space":
        world.weather = "clear"

    concrete = bool(cast or props or settings or times or weathers)
    if concrete:
        world.last_concrete = idx
    abstract = not cast and not props and idx - world.last_concrete > 2

    mood = moods.most_common(1)[0][0] if moods else "neutral"
    if cast:
        # Most recent first, so "they" can reach back past the last scene.
        seen = [{k: a[k] for k in ("id", "kind", "name", "count")} for a in cast]
        ids = {a["id"] for a in seen}
        world.cast = (seen + [a for a in world.cast if a["id"] not in ids])[:5]
        world.last_size = len(seen)

    # ---- camera ----------------------------------------------------------
    acts = {a["action"] for a in cast}
    if abstract:
        camera = "orbit"
    elif acts & {"walk", "run"}:
        camera = "track"
    elif idx == 0:
        camera = "crane"
    elif not cast:
        camera = ("dolly", "crane")[idx % 2]
    else:
        camera = ("orbit", "dolly", "orbit", "crane")[idx % 4]

    return {
        "text": " ".join(captions),
        "captions": captions,
        "abstract": abstract,
        "setting": world.setting or "meadow",
        "time": world.time,
        "weather": world.weather,
        "mood": mood,
        "camera": camera,
        "actors": [
            {"id": a["id"], "kind": a["kind"], "name": a["name"],
             "count": min(a["count"], 5), "action": a["action"],
             "model": {k: v for k, v in L.MODELS[a["kind"]].items()
                       if k not in ("default", "implies", "water")}}
            for a in cast[:6]
        ],
        "props": [{"kind": p, **L.PROPS[p]} for p in props[:5]],
        "keywords": _keywords(words),
    }


def build_storyboard(text: str, max_scenes: int = 12, pace: float = 1.0) -> dict:
    """Parse ``text`` into a storyboard dict ready for ``viewer.render_html``.

    max_scenes: longer texts are grouped so the animation has at most this many shots.
    pace:       duration multiplier (2.0 = twice as slow).
    """
    text = (text or "").strip()
    sentences = split_sentences(text) if text else []
    names = find_names(sentences)
    world = _World()

    scenes = []
    for idx, captions in enumerate(_chunk(sentences, max(1, max_scenes))):
        scene = _parse_scene(idx, captions, names, world)
        seconds = sum(min(11.0, max(3.5, len(c.split()) / 2.6)) for c in captions)
        scene["duration"] = round(seconds * pace, 2)
        scenes.append(scene)

    title = " ".join(text.split()[:7]) + ("…" if len(text.split()) > 7 else "")
    return {
        "title": title,
        "seed": zlib.crc32(text.encode("utf-8")) & 0xFFFFFF,
        "duration": round(sum(s["duration"] for s in scenes), 2),
        "scenes": scenes,
    }
