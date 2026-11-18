"""Turn free text into a storyboard: a list of scenes the 3D viewer can stage.

The parser is deliberately rule-based so the app runs offline with no API key.
It splits the text into scenes, then for each scene looks up words in the
lexicon to decide who is on stage, what they are doing, where and when it
happens, the weather and the mood. World state (place, time of day, weather,
cast) carries over between scenes the way it does for a reader.
"""

from __future__ import annotations

import random
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
    if word.endswith("men") and len(word) > 5:
        yield word[:-3] + "man", True          # fishermen, policemen
    for suffix, repl in _PLURAL_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            yield word[: -len(suffix)] + repl, True
    if word.endswith("ied") and len(word) > 4:
        yield word[:-3] + "y", False               # carried, hurried
    for suffix in _VERB_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            stem = word[: -len(suffix)]
            if suffix == "d":                      # danced -> dance, but bed is not "bee"
                if stem.endswith("e"):
                    yield stem, False
                continue
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
    return word in L.PLACE_DRESSING or any(
        _find(word, t)
        for t in (L.ACTOR_WORDS, L.PROP_WORDS, L.SETTING_WORDS, L.TIME_WORDS,
                  L.WEATHER_WORDS, L.ACTION_WORDS, L.MOOD_WORDS, L.COLLECTIVES)
    )


_NOUN_TABLES = (L.ACTOR_WORDS, L.PROP_WORDS, L.SETTING_WORDS, L.TIME_WORDS,
                L.WEATHER_WORDS, L.COLLECTIVES)


def _split_compound(word: str) -> list[str] | None:
    """"townspeople" -> ["towns", "people"] when both halves are things we can draw."""
    if len(word) < 7 or word in L.STOPWORDS or word in L.NOT_COMPOUND or _known(word):
        return None
    for i in range(3, len(word) - 3):
        left, right = word[:i], word[i:]
        if all(any(_find(part, t) for t in _NOUN_TABLES) for part in (left, right)):
            return [left, right]
    return None


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
    # A name seen once, at the start of a sentence, still counts when what follows
    # says so: "Max and Bella ...", "Max the dog ...", "Max was a dog", "Max ran".
    for sentence in sentences:
        toks = [w.split("'")[0] for w, _ in _tokens(sentence)]
        for i, word in enumerate(toks):
            low = word.lower()
            if word in names or i or word not in start or low in L.NOT_NAMES or low.endswith("ly"):
                continue
            nxt = [t.lower() for t in toks[i + 1: i + 4]]
            if (nxt[:1] == ["and"] and len(toks) > i + 2 and toks[i + 2][:1].isupper()) \
                    or (nxt[:1] and nxt[0] in L.APPOSITION and any(_find(t, L.ACTOR_WORDS) for t in nxt[1:])) \
                    or (nxt[:1] and (_find(nxt[0], L.ACTION_WORDS) or _find(nxt[0], L.KILL_WORDS))):
                names.add(word)
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
        self.dead: set[str] = set()  # ids of characters who have died
        self.name_kind: dict[str, str] = {}
        self.name_desc: dict[str, tuple] = {}
        self.last_concrete = -99
        # creative liberty (0 = literal)
        self.liberty = 0
        self.rng = random.Random(0)
        self.default_setting = "meadow"
        self.weather_in_text = True


def _parse_scene(idx: int, captions: list[str], names: set[str], world: _World) -> dict:
    toks = [t for c in captions for t in _tokens(c)]
    words: list[str] = []
    for w, _ in toks:
        parts = None if w.split("'")[0] in names else _split_compound(w.lower())
        words.extend(parts or [w])
    lows = [L.TYPOS.get(w.lower(), w.lower()) for w in words]

    actors: dict[str, dict] = {}
    props: list[str] = []
    prop_pos: dict[str, int] = {}
    actions: list[tuple[int, str]] = []
    foods: list[dict] = []
    meal_food: str | None = None
    meal_pos: list[int] = []
    said_to_be: str | None = None
    settings, hints, times, weathers, moods = [], [], [], [], Counter()

    def add_actor(kind: str, pos: int, count: int = 1, name: str | None = None,
                  word: str | None = None, desc: tuple = (), plural: bool = False) -> dict:
        fresh = bool(set(lows[max(0, pos - 2): pos]) & ({"a", "an", "one"} | L.OTHER_WORDS))
        if not name and not desc and not fresh and kind not in {
                a["kind"] for a in actors.values() if not a.get("desc") and not a["name"]}:
            # A bare "the dog" after "a brown dog" (or "Max the dog") means that dog,
            # not a new one.
            same = [a for a in actors.values() if a["kind"] == kind and (a.get("desc") or a["name"])]
            remembered = [a for a in world.cast if a["kind"] == kind and (a.get("desc") or a["name"])
                          and a["id"] not in world.dead]
            if same and not plural:
                return same[-1]
            if remembered:
                picks = remembered if plural else remembered[:1]
                for prev in picks:
                    actors.setdefault(prev["id"], {**prev, "pos": pos, "words": {word}})
                return actors[picks[0]["id"]]
        key = f"{kind}:{name}" if name else f"{kind}:{'-'.join(desc)}" if desc else kind
        actor = actors.get(key)
        if actor is None:
            actor = actors[key] = {"id": key, "kind": kind, "name": name, "desc": desc,
                                   "count": count, "pos": pos, "words": {word}}
        elif set(lows[max(0, pos - 2): pos]) & ({"a", "an"} | L.OTHER_WORDS) \
                or (word and word not in actor["words"]):
            # "a boy and a girl", "the pirate and the ninja": two characters
            actor["count"] += count
            actor["words"].add(word)
        else:
            actor["count"] = max(actor["count"], count)
        return actor

    def eating_word(w: str) -> bool:
        hit = _find(w, L.ACTION_WORDS)
        return bool(hit and hit[0] in ("eat", "drink", "feed")) or any(
            stem in L.EAT_IF_FOOD for stem, _ in _candidates(w))

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
                last_actor = (i, add_actor(kind, i, 1, base, desc=world.name_desc.get(base, ())))
            continue
        low = low.split("'")[0]

        if low == "balloon" and "air" in lows[max(0, i - 2): i]:
            last_actor = (i, add_actor("balloon", i))          # hot-air balloon
            continue
        after_eating = any(eating_word(w) for w in lows[max(0, i - 4): i])
        food_kind = None
        if (hit := _find(low, L.FOOD_WORDS)) and (
                low not in L.FOOD_ONLY_AFTER_EATING or after_eating):
            food_kind = hit[0]
        elif after_eating and (hit := _find(low, L.ACTOR_WORDS)) and hit[0] in L.EDIBLE_ACTORS:
            food_kind = L.EDIBLE_ACTORS[hit[0]]              # "the cat ate the fish"
        if hit := _find(low, L.MEAL_FOOD):
            meal_food = meal_food or hit[0]
            meal_pos.append(i)

        next_is_actor = i + 1 < len(lows) and bool(_find(lows[i + 1], L.ACTOR_WORDS))
        if low in L.DESCRIBERS and next_is_actor and not food_kind:
            continue                     # "baby dragon", "robot dog": it describes the dragon
        appos = _apposition(words, lows, i, names)
        if appos and (hit := _find(low, L.ACTOR_WORDS)):
            # "Max the dog", "Max and Bella were dogs": the names are what they are called
            for name in appos[0]:
                world.name_kind[name] = hit[0]
                if appos[1]:
                    world.name_desc[name] = appos[1]
                old = next((a for a in actors.values() if a["name"] == name), None)
                if old and old["kind"] != hit[0]:
                    del actors[old["id"]]
                    add_actor(hit[0], old["pos"], 1, name, desc=appos[1])
                elif old and appos[1]:
                    old["desc"] = appos[1]
            continue
        k = i - 1
        while k >= 0 and (lows[k] in L.PREDICATE_FILLER or lows[k] in L.DESCRIBERS):
            k -= 1
        predicate = k >= 1 and lows[k] in L.LINKING and lows[k - 1] != "there" and (
            lows[k - 1] in L.PRONOUNS | L.FIRST_PERSON or bool(_find(lows[k - 1], L.ACTOR_WORDS))
            or words[k - 1].split("'")[0] in names)
        if food_kind:
            foods.append({"kind": food_kind, "pos": i, "word": low, "used": False})
        elif predicate and (low in L.COLLECTIVES or _find(low, L.ACTOR_WORDS)):
            # "they were best friends": says what they are, not who
            said_to_be = said_to_be or (L.COLLECTIVES[low][0] if low in L.COLLECTIVES
                                        else _find(low, L.ACTOR_WORDS)[0])
        elif low in L.GROUP_REFS and (actors or any(a["id"] not in world.dead for a in world.cast)):
            pass                         # "everyone" = the characters we already know
        elif low in L.COLLECTIVES:
            kind, count = L.COLLECTIVES[low]
            last_actor = (i, add_actor(kind, i, count, word=low))
        elif hit := _find(low, L.ACTOR_WORDS):
            kind, plural = hit
            many = world.rng.randint(3, 5) if world.liberty else 3
            count = many if plural else 1
            for back in lows[max(0, i - 2): i]:
                count = L.NUMBERS.get(back, count)
            stem = next((s for s, _ in _candidates(low) if s in L.ACTOR_WORDS), low)
            desc: list[str] = []
            for back in reversed(lows[max(0, i - 3): i]):    # "the big brown dog"
                if back not in L.DESCRIBERS:
                    break
                desc.insert(0, back)
            last_actor = (i, add_actor(kind, i, count, word=stem, desc=tuple(desc), plural=plural))
        elif low == "other" and last_actor and not last_actor[1]["name"] and lows[i - 1] != "each" and (
                i + 1 >= len(lows) or _find(lows[i + 1], L.ACTION_WORDS)
                or _find(lows[i + 1], L.KILL_WORDS) or lows[i + 1] in ("and", "but", "then", "back")):
            last_actor[1]["count"] += 1                     # "one dog bit the other"
        elif hit := _find(low, L.PROP_WORDS):
            if hit[0] not in props:
                props.append(hit[0])
                prop_pos[hit[0]] = i

        for dressing in L.PLACE_DRESSING.get(low, ()):
            if dressing not in props:
                props.append(dressing)
        if hit := _find(low, L.SETTING_WORDS):
            settings.append(hit[0])
        if hit := _find(low, L.HINT_WORDS):
            hints.append(hit[0])
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
        if pos >= 0 and not any(p > pos for p, _ in actions):
            # Its verb comes before it, so it is what the verb was done to: "the bird
            # flew over the dog" does not make the dog fly.
            can_fly = model["base"] in L.FLYERS or model["base"] == "bird" or model.get("wings")
            if (action == "fly" and not can_fly) or (action == "swim" and not model.get("water")) \
                    or action in ("jump", "look"):
                action = model.get("default", "idle") if model.get("default") != "fly" or can_fly else "idle"
        if model["base"] in L.VEHICLES:
            # Vehicles only drive, fly or stand still, whatever the nearby verb says.
            if action in ("walk", "run") or (action == "fly" and model["base"] in L.FLYERS):
                return action
            return "idle" if action in ("idle", "sleep", "look") else model.get("default", "idle")
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
    plural = bool(low_set & ({"they", "them", "their", "theirs"} | L.GROUP_REFS))
    dead_before = set(world.dead)
    if low_set & L.REVIVE_WORDS:
        world.dead -= set(actors)
        dead_before -= set(actors)
    for actor in cast:
        if actor["id"] in dead_before:
            actor["action"] = "dead"     # still lying where they fell
    living = [a for a in world.cast if a["id"] not in world.dead]   # the dead stay out
    latest = [a for a in world.cast[: world.last_size] if a["id"] not in world.dead]
    if plural:
        recalled = living[: max(len(latest), 2)]
    else:  # he / she / it: prefer a single character over a group
        recalled = ([a for a in latest if a["count"] == 1]
                    or [a for a in living if a["count"] == 1][:1] or latest)
    if not cast:
        if recalled and (low_set & L.PRONOUNS or subjects or physical):
            for prev in recalled:
                cast.append({**prev, "action": act_for(prev["kind"], -1)})
            # Whoever was riding is still riding, as long as their ride came along.
            here = {a["id"] for a in cast}
            for actor in cast:
                if actor.get("riding") in here:
                    actor["action"] = "ride"
                else:
                    actor["riding"] = None
        elif (low_set & L.FIRST_PERSON or low_set & L.SUBJECT_PRONOUNS) and (physical or said_to_be):
            # "I ran", "she danced", "they were dogs" with nobody introduced yet
            count = 2 if low_set & {"we", "us", "our", "they"} else 1
            kind = said_to_be or "person"
            cast.append({"id": f"{kind}:narrator", "kind": kind, "name": None,
                         "count": count, "action": physical[0] if physical else act_for(kind, -1)})
    elif world.cast:
        first = min(a["pos"] for a in cast)
        lead = [i for i in subjects if i < first]
        if lead:
            present = {a["id"] for a in cast}
            extra = [p for p in recalled if p["id"] not in present][:4]
            for prev in extra:
                cast.insert(0, {**prev, "action": act_for(prev["kind"], lead[0])})

    # Some words need a second character: "each other", "together", "the dog bit
    # him", "everyone". If only one is on stage, bring back whoever we already know.
    present_n = sum(a["count"] for a in cast)
    reciprocal = bool(low_set & L.RECIPROCAL) or _phrase(lows, "each", "other") \
        or _phrase(lows, "one", "another")
    object_refs = [i for i, w in enumerate(lows) if w in ("him", "her", "them")
                   or (w == "it" and i and _find(lows[i - 1], L.ACTION_WORDS)
                       and _find(lows[i - 1], L.ACTION_WORDS)[0] == "fight")]
    if world.cast and cast and present_n < 2 and (reciprocal or plural or object_refs):
        present = {a["id"] for a in cast}
        pool = [p for p in living if p["id"] not in present
                and L.MODELS[p["kind"]]["base"] not in L.VEHICLES]
        many = reciprocal or plural or "them" in low_set
        for prev in pool[:4] if many else pool[:1]:
            cast.append({**prev, "action": act_for(prev["kind"], -1), "riding": None})

    # ---- life and death --------------------------------------------------
    placed = sorted((a for a in cast if a.get("pos", -1) >= 0), key=lambda a: a["pos"])
    for i, low in enumerate(lows):
        hit = _find(low, L.KILL_WORDS)
        if not hit:
            continue
        before = next((a for a in reversed(placed) if a["pos"] < i), None)
        after = next((a for a in placed if a["pos"] > i), None)
        killer = None
        if hit[0] == "die":
            victim = before or (cast[0] if len(cast) == 1 else None)
        elif set(lows[max(0, i - 2): i]) & L.PASSIVE_MARKERS:      # "was slain by ..."
            victim = before
            killer = after if after and "by" in lows[i + 1: after["pos"]] else None
        else:
            victim, killer = after, before
            if victim is None and set(lows[i + 1: i + 3]) & L.OBJECT_PRONOUNS:
                # "He slew it": the pronouns brought the cast back in the order they
                # were introduced, so the object is the last of them.
                carried = [a for a in cast if a.get("pos", -1) < 0]
                present = {a["id"] for a in cast}
                gone = next((p for p in living if p["id"] not in present), None)
                if len(carried) > 1:
                    victim = carried[-1]
                elif gone:
                    victim = {**gone}
                    cast.append(victim)
            if killer is None:
                killer = next((a for a in cast if a is not victim), None)
        if victim is None or victim["id"] in dead_before:
            continue
        victim["action"] = "die"
        world.dead.add(victim["id"])
        if killer is not None and killer is not victim and killer["action"] != "die":
            killer["action"] = "slay"

    # ---- eating and drinking ---------------------------------------------
    def base_of(actor: dict) -> str:
        return L.MODELS[actor["kind"]]["base"]

    def verbish(w: str) -> bool:
        return bool(_find(w, L.ACTION_WORDS) or _find(w, L.KILL_WORDS)) or eating_word(w)

    placed = sorted((a for a in cast if a.get("pos", -1) >= 0), key=lambda a: a["pos"])

    def group_before(i: int) -> list[dict]:
        """The characters doing the verb at i: 'the boy and the dog ate ...'."""
        group: list[dict] = []
        edge = i
        for a in reversed([a for a in placed if a["pos"] < i]):
            between = lows[a["pos"] + 1: edge]
            if len(between) > 5 or set(between) & L.CLAUSE_BREAKS \
                    or any(verbish(w) for w in between):
                break
            group.append(a)
            edge = a["pos"]
        if len(group) > 1 and any(verbish(w) for w in lows[max(0, group[-1]["pos"] - 4): group[-1]["pos"]]):
            group.pop()   # "the dog chased the cat and the boy ate": the cat is chased, not eating
        if not group:     # "they ate", "then ate": whoever was carried over
            group = [a for a in cast if a.get("pos", -1) < 0] or (cast[:1] if len(cast) == 1 else [])
        return [a for a in group if base_of(a) not in L.VEHICLES]

    def group_after(i: int, limit: int = 5, vehicles: bool = False) -> list[dict]:
        group: list[dict] = []
        edge = i
        for a in [a for a in placed if a["pos"] > i]:
            between = lows[edge + 1: a["pos"]]
            if len(between) > limit or set(between) & L.CLAUSE_BREAKS \
                    or any(verbish(w) for w in between):
                break
            group.append(a)
            edge = a["pos"]
        while len(group) > 1 and group[-1]["pos"] + 1 < len(lows) and verbish(lows[group[-1]["pos"] + 1]):
            group.pop()   # "slew the dragon and the villagers cheered": the villagers cheer
        return [a for a in group if vehicles or base_of(a) not in L.VEHICLES]

    def default_food(actor: dict, drink: bool) -> str:
        if drink:
            return L.DRINKER_FOOD.get(actor["kind"], "juice" if base_of(actor) in ("person", "robot")
                                      else "water")
        if meal_food and base_of(actor) in ("person", "robot"):
            return meal_food
        return L.EATER_FOOD.get(actor["kind"], "sandwich" if base_of(actor) in ("person", "robot")
                                else "grass" if base_of(actor) == "quad" else "seeds")

    food_of: dict[str, str] = {}
    for i, low in enumerate(lows):
        hit = _find(low, L.ACTION_WORDS)
        kind = hit[0] if hit and hit[0] in ("eat", "drink", "feed") else None
        nxt = next((f for f in foods if 0 < f["pos"] - i <= 6 and not f["used"]), None)
        if kind is None and eating_word(low) and (
                (nxt and nxt["pos"] - i <= 4) or any(0 < p - i <= 3 for p in meal_pos)):
            kind = "eat"                     # "had a burger", "bit into an apple", "had dinner"
        if kind is None:
            continue
        if kind == "eat" and nxt and L.FOOD[nxt["kind"]]["drink"]:
            kind = "drink"                                 # "had a coffee"
        if kind == "feed":
            feeders, eaters = group_before(i), group_after(i)
        else:
            feeders, eaters = [], group_before(i)
        prey = None if nxt or kind != "eat" else next(
            (a for a in group_after(i, 3) if a not in eaters), None)
        if prey is not None and eaters and prey["id"] not in dead_before:
            prey["action"] = "die"                         # "the wolf ate the pig"
            world.dead.add(prey["id"])
            for eater in eaters:
                eater["action"] = "slay"
            continue
        if nxt:
            nxt["used"] = True
        for eater in eaters:
            if eater["action"] in ("die", "dead", "slay"):
                continue
            food = nxt["kind"] if nxt else default_food(eater, kind == "drink")
            food_of[eater["id"]] = food
            if eater["action"] not in ("walk", "run", "ride") or kind == "feed":
                eater["action"] = "drink" if L.FOOD[food]["drink"] else "eat"
        for feeder in feeders:
            if eaters:
                food_of[feeder["id"]] = food_of.get(eaters[0]["id"], "bread")
                feeder["action"] = "feed"

    for actor in cast:          # picked "eat" from a nearby verb but is not the one eating
        if actor["action"] in ("eat", "drink", "feed") and actor["id"] not in food_of:
            earlier = [k for p, k in actions if p < actor.get("pos", -1)
                       and k not in ("eat", "drink", "feed")]
            actor["action"] = earlier[-1] if earlier else "idle"

    # ---- who rides, holds or sits on what --------------------------------

    def others_between(lo: int, hi: int) -> bool:
        return any(lo < a["pos"] < hi for a in placed)

    placed = sorted((a for a in cast if a.get("pos", -1) >= 0), key=lambda a: a["pos"])
    for mount in placed:
        mbase, mpos = base_of(mount), mount["pos"]
        vehicle = mbase in L.VEHICLES
        if not vehicle and mbase not in ("quad", "bird", "fish"):
            continue
        near = set(lows[max(0, mpos - 3): mpos])
        verb_used = None
        for rider in placed:
            if rider is mount or rider.get("riding") or mount.get("riding") \
                    or base_of(rider) in L.VEHICLES:
                continue
            rpos = rider["pos"]
            if rpos < mpos:                                   # "a dog riding in a car"
                between = lows[rpos + 1: mpos]
                if len(between) > 9:
                    continue
                verbs = [(j, _find(w, L.RIDE_WORDS)) for j, w in enumerate(between)]
                verbs = [(j, hit[0], next(s for s, _ in _candidates(between[j])
                                          if s in L.RIDE_WORDS))
                         for j, hit in verbs if hit]
                if not vehicle:
                    verbs = [v for v in verbs if v[2] in L.RIDE_ANIMAL_VERBS]
                if verbs:
                    j, kind, _ = verbs[-1]
                    if set(between[j + 1:]) & L.RIDE_BLOCKERS \
                            or others_between(rpos + 1 + j, mpos):
                        continue
                    verb_used = verb_used or kind
                elif not (near & (L.INSIDE_WORDS if vehicle else L.ONTOP_WORDS)) \
                        or len(between) > 5 or set(between) & {"past", "near", "behind"}:
                    continue
            else:                                             # "a car driven by a dog"
                between = lows[mpos + 1: rpos]
                rode = [_find(w, L.RIDE_WORDS) for w in between]
                passive = "by" in between and any(rode)
                inside = "with" in between and set(lows[rpos + 1: rpos + 3]) & L.INSIDE_WORDS
                carrying = any(w.startswith("carr") for w in between)
                if len(between) > 6 or not (passive or inside or carrying) \
                        or others_between(mpos, rpos):
                    continue
                verb_used = verb_used or ("move" if passive or carrying else None)
            if rider["action"] in ("fight", "slay"):
                mount["action"] = rider["action"]    # the horse carries the knight into the fight
                rider["armed"] = True
            rider["riding"] = mount["id"]
            rider["action"] = "ride"
            mount["carrying"] = True
        if mount.get("carrying") and verb_used and verb_used != "sit":
            model = L.MODELS[mount["kind"]]
            if verb_used == "fly" and (mbase in L.FLYERS or mbase == "bird" or model.get("wings")):
                mount["action"] = "fly"
            elif mbase == "fish":
                mount["action"] = "swim"
            elif mount["action"] not in ("walk", "run", "fly", "fight", "slay"):
                mount["action"] = "walk"

    holding: dict[str, str] = {}
    table_items: list[str] = []
    for food in foods:                       # food nobody eats: held, on the table, or a prop
        if food["used"]:
            continue
        before = [a for a in reversed(placed) if 0 < food["pos"] - a["pos"] <= 10
                  and base_of(a) not in L.VEHICLES]
        holder = before[0] if before else None
        between = lows[holder["pos"] + 1: food["pos"]] if holder else []
        if holder and holder["id"] not in holding and holder["id"] not in food_of and (
                set(between) & L.HOLD_PREPS or any(_find(w, L.HOLD_WORDS) for w in between)):
            holding[holder["id"]] = "food:" + food["kind"]
        elif "table" in props:
            table_items.append(food["kind"])
        elif (hit := _find(food["word"], L.PROP_WORDS)) and hit[0] not in props:
            props.append(hit[0])
            prop_pos[hit[0]] = food["pos"]
    for kind in list(props):
        ppos = prop_pos.get(kind, -1)
        before = [a for a in reversed(placed) if 0 < ppos - a["pos"] <= 10]
        holder = before[0] if before else None
        if holder is not None and holder.get("carrying"):   # the rider holds it, not the horse
            holder = next((a for a in placed if a.get("riding") == holder["id"]), holder)
        if kind not in L.HOLDABLE or holder is None or holder["id"] in holding \
                or base_of(holder) in L.VEHICLES or holder["action"] in ("die", "dead"):
            continue
        between = lows[holder["pos"] + 1: ppos]
        if (set(between) & L.HOLD_PREPS
                                  or any(_find(w, L.HOLD_WORDS) for w in between)):
            holding[holder["id"]] = kind
            props.remove(kind)

    for actor in cast:
        if actor.get("armed") and actor["id"] not in holding and base_of(actor) == "person":
            holding[actor["id"]] = "sword"

    # ---- who fights whom: the side before the fighting word and the side after
    fighters = [a for a in cast if a["action"] in ("fight", "slay", "die")]
    verbs = [i for i, w in enumerate(lows)
             if ((h := _find(w, L.ACTION_WORDS)) and h[0] == "fight") or _find(w, L.KILL_WORDS)
             or (eating_word(w) and any(a["action"] == "slay" for a in fighters))]
    sided: set[str] = set()
    for i in verbs:
        if not ((h := _find(lows[i], L.ACTION_WORDS)) and h[0] == "fight"):
            continue
        attackers = [a for a in group_before(i) if a["action"] not in ("die", "dead")]
        targets = [a for a in group_after(i, vehicles=True)
                   if a not in attackers and a["action"] not in ("die", "dead")]
        if not attackers or not targets:
            continue
        for a in attackers:              # "the shark attacked the boat": the boat is in it too
            if a["action"] not in ("slay", "ride"):
                a["action"] = "fight"
            a["side"] = 0
            sided.add(a["id"])
        for a in targets:
            if a["action"] not in ("slay", "ride"):
                a["action"] = "fight"
            a["passive"] = base_of(a) in L.VEHICLES and base_of(a) not in L.FLYERS \
                and base_of(a) != "tank"
            a["side"] = 1
            sided.add(a["id"])
    fighters = [a for a in cast if a["action"] in ("fight", "slay", "die")]
    if fighters and verbs:
        for a in fighters:
            if a["id"] not in sided:
                a["side"] = 0 if a.get("pos", -1) < verbs[0] else 1
        if len({a["side"] for a in fighters}) == 1 and len(fighters) > 1:
            for a in fighters[1:]:      # "the cat and the dog fought": one against the other
                a["side"] = 1
        killers = [a for a in fighters if a["action"] == "slay"]
        for victim in (a for a in fighters if a["action"] == "die"):
            if killers and killers[0]["side"] == victim["side"]:
                victim["side"] = 1 - victim["side"]

    for kind in props:
        ppos = prop_pos.get(kind, -1)
        if kind not in L.SEATABLE or not set(lows[max(0, ppos - 3): ppos]) & L.INSIDE_WORDS:
            continue
        for actor in placed:
            if 0 < ppos - actor["pos"] <= 10 and actor["action"] in L.STILL_ACTIONS \
                    and not actor.get("riding") and not actor.get("on") \
                    and base_of(actor) not in L.VEHICLES:
                actor["on"] = kind

    # ---- where and when --------------------------------------------------
    models = [L.MODELS[a["kind"]] for a in cast]
    implied = next((m["implies"] for m in models if "implies" in m), None)
    implied = implied or next(
        (L.PROPS[p]["implies"] for p in props if "implies" in L.PROPS[p]), None)
    needs_water = any(m.get("water") for m in models) or any(
        a["action"] == "swim" for a in cast)

    previous_setting = world.setting
    if settings:
        # Two places in one breath: water wins (so the sea is on screen), then
        # the last one named; the other becomes scenery.
        distinct = list(dict.fromkeys(settings))
        primary = ([s for s in distinct if s in L.WATER_SETTINGS] or distinct)[-1]
        for other in distinct:
            dressing = L.SETTING_PROPS.get(other)
            if other != primary and dressing and dressing not in props:
                props.append(dressing)
        world.setting = primary
        world.setting_explicit = True
    elif hints and not world.setting_explicit:
        world.setting = hints[-1]
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

    concrete = bool(cast or props or settings or hints or times or weathers)
    if concrete:
        world.last_concrete = idx
    abstract = not cast and not props and idx - world.last_concrete > 2

    mood = moods.most_common(1)[0][0] if moods else "neutral"
    if cast:
        # Most recent first, so "they" can reach back past the last scene.
        seen = [{"id": a["id"], "kind": a["kind"], "name": a["name"], "count": a["count"],
                 "riding": a.get("riding"), "desc": a.get("desc", ())} for a in cast]
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
        camera = (world.rng.choice(("dolly", "crane", "orbit")) if world.liberty
                  else ("dolly", "crane")[idx % 2])
    else:
        camera = ("orbit", "dolly", "orbit", "crane")[idx % 4]

    setting = world.setting or world.default_setting
    weather = world.weather
    extras: list[dict] = []
    if world.liberty and not abstract:
        rng, lib = world.rng, world.liberty
        moody = L.MOOD_WEATHER.get(mood)
        if moody and not world.weather_in_text and setting != "space" \
                and rng.random() < 0.3 * lib:
            weather = moody
        taken = {a["kind"] for a in cast}
        options = [o for o in L.AMBIENT.get(setting, []) if o[0] not in taken]
        if cast:  # the stage belongs to the cast: only add life in the air or water
            options = [o for o in options
                       if o[1] in ("fly", "swim") or L.MODELS[o[0]].get("water")]
            want = 1 if rng.random() < 0.45 * lib else 0
        else:
            want = lib + 1
        for kind, action, count in rng.sample(options, min(want, len(options))):
            if world.time == "night":
                kind = L.NIGHT_SWAP.get(kind, kind)
            extras.append({"id": f"ambient:{kind}", "kind": kind, "name": None,
                           "count": count, "action": action, "ambient": True})
        if not props and rng.random() < 0.45 * lib:
            pool = list(L.AMBIENT_PROPS.get(setting, []))
            if world.time == "night" and setting not in ("city", "space"):
                pool.append("campfire")
            if pool:
                props.append(rng.choice(pool))

    return {
        "text": " ".join(captions),
        "captions": captions,
        "abstract": abstract,
        "setting": setting,
        "time": world.time,
        "weather": weather,
        "mood": mood,
        "camera": camera,
        "actors": [
            {"id": a["id"], "kind": a["kind"], "name": a["name"],
             "count": min(a["count"], 5), "action": a["action"],
             "ambient": bool(a.get("ambient")),
             "riding": a.get("riding"), "on": a.get("on"),
             "holding": _held(holding.get(a["id"])),
             "food": ({"kind": food_of[a["id"]], "drink": L.FOOD[food_of[a["id"]]]["drink"]}
                      if a["id"] in food_of else None),
             "side": a.get("side", 0), "passive": bool(a.get("passive")),
             "model": _look(a)}
            for a in cast[:6] + extras
        ],
        "props": [{"kind": p, **L.PROPS[p],
                   **({"items": table_items[:6]} if p == "table" and table_items else {})}
                  for p in props[:5]],
        "keywords": _keywords(words),
    }


def _phrase(lows: list[str], first: str, second: str) -> bool:
    return any(a == first and b == second for a, b in zip(lows, lows[1:]))


def _apposition(words: list[str], lows: list[str], i: int, names: set[str]):
    """'Max the dog', 'Max and Bella were dogs', 'Max, a brown dog' -> (names, describing words)."""
    j, between = i - 1, []
    while j >= 0 and words[j].split("'")[0] not in names and (
            lows[j] in L.APPOSITION or lows[j] in L.DESCRIBERS):
        between.append(lows[j])
        j -= 1
    if j < 0 or words[j].split("'")[0] not in names or not set(between) & L.APPOSITION:
        return None
    group, k = [], j
    while k >= 0:
        name = words[k].split("'")[0]
        if name in names:
            group.append(name)
        elif lows[k] != "and":
            break
        k -= 1
    return group, tuple(w for w in reversed(between) if w in L.DESCRIBERS)


def _look(actor: dict) -> dict:
    """The actor's model, coloured and sized by its describing words."""
    model = {k: v for k, v in L.MODELS[actor["kind"]].items()
             if k not in ("default", "implies", "water")}
    if actor.get("carrying"):
        model["open"] = True
    for word in actor.get("desc") or ():
        if L.COLOR_WORDS.get(word):
            model["color"] = L.COLOR_WORDS[word]
            model.pop("pattern", None)
            if model.get("skin") and model["base"] == "person" and model.get("ghost"):
                model["skin"] = model["color"]
        if word in L.PATTERN_WORDS and model["base"] == "quad":
            model["pattern"] = L.PATTERN_WORDS[word]
            model["ink"] = "#1d1a17"
        if word in L.SIZE_WORDS:
            model["scale"] = round(model.get("scale", 1) * L.SIZE_WORDS[word], 3)
    return model


def _held(kind: str | None) -> dict | None:
    if kind is None:
        return None
    if kind.startswith("food:"):
        food = kind[5:]
        return {"kind": food, "base": "food", "scale": 1.0, "food": True}
    return {"kind": kind, "base": L.PROPS[kind]["base"], "scale": L.HOLDABLE[kind]}


def build_storyboard(text: str, max_scenes: int = 12, pace: float = 1.0,
                     liberty: int = 0, variation: int = 0) -> dict:
    """Parse ``text`` into a storyboard dict ready for ``viewer.render_html``.

    max_scenes: longer texts are grouped so the animation has at most this many shots.
    pace:       duration multiplier (2.0 = twice as slow).
    liberty:    0 stages only what the text says; 1 and 2 let the app add ambient
                life, set dressing, weather and a time of day the text left open.
    variation:  a different number gives a different take on the same text.
    """
    text = (text or "").strip()
    sentences = split_sentences(text) if text else []
    names = find_names(sentences)
    world = _World()
    for sentence in sentences:                     # learn "Max was a dog" before staging anything
        toks = [w for w, _ in _tokens(sentence)]
        lows = [L.TYPOS.get(w.lower(), w.lower()) for w in toks]
        for i, low in enumerate(lows):
            if (hit := _find(low, L.ACTOR_WORDS)) and (found := _apposition(toks, lows, i, names)):
                for name in found[0]:
                    world.name_kind.setdefault(name, hit[0])
                    if found[1]:
                        world.name_desc.setdefault(name, found[1])
    seed = (zlib.crc32(text.encode("utf-8")) + variation * 9973) & 0xFFFFFF
    if liberty:
        every = [w.lower() for s in sentences for w, _ in _tokens(s)]
        world.liberty = max(0, min(2, int(liberty)))
        world.rng = random.Random(seed)
        world.default_setting = world.rng.choice(L.FREE_SETTINGS)
        world.weather_in_text = any(_find(w, L.WEATHER_WORDS) for w in every)
        if not any(_find(w, L.TIME_WORDS) for w in every):
            world.time = world.rng.choice(
                ["day", "day", "sunset", "dawn"] + (["night"] if world.liberty > 1 else []))

    scenes = []
    for idx, captions in enumerate(_chunk(sentences, max(1, max_scenes))):
        scene = _parse_scene(idx, captions, names, world)
        seconds = sum(min(11.0, max(4.5, len(c.split()) / 2.6)) for c in captions)
        scene["duration"] = round(seconds * pace, 2)
        scenes.append(scene)

    title = " ".join(text.split()[:7]) + ("…" if len(text.split()) > 7 else "")
    return {
        "title": title,
        "seed": seed,
        "duration": round(sum(s["duration"] for s in scenes), 2),
        "scenes": scenes,
    }
