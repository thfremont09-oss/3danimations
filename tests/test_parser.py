from story3d import build_storyboard, render_html
from story3d.parser import find_names, split_sentences


def scene(text, index=-1):
    return build_storyboard(text)["scenes"][index]


def cast(sc):
    return {a["id"]: a["action"] for a in sc["actors"]}


def test_splits_sentences_and_glues_fragments():
    assert split_sentences("A fox ran. Oh! It was fast.") == ["A fox ran.", "Oh! It was fast."]
    assert split_sentences("line one here\nline two here") == ["line one here", "line two here"]


def test_empty_text_gives_no_scenes():
    assert build_storyboard("   ")["scenes"] == []


def test_actor_action_setting_and_time():
    sc = scene("At night a fox ran through the forest.")
    assert cast(sc) == {"fox": "run"}
    assert (sc["setting"], sc["time"], sc["camera"]) == ("forest", "night", "track")


def test_plurals_and_number_words():
    sc = scene("Two dogs chased the rabbits.")
    counts = {a["kind"]: a["count"] for a in sc["actors"]}
    assert counts == {"dog": 2, "rabbit": 3}


def test_names_become_characters_and_attach_to_titles():
    text = "The wizard Merlin walked to the castle. Later Merlin slept."
    assert find_names(split_sentences(text)) == {"Merlin"}
    board = build_storyboard(text)
    assert cast(board["scenes"][0]) == {"wizard:Merlin": "walk"}
    assert cast(board["scenes"][1]) == {"wizard:Merlin": "sleep"}
    assert board["scenes"][0]["props"][0]["kind"] == "castle"


def test_places_are_not_mistaken_for_people():
    assert find_names(["A man travelled to Paris."]) == set()


def test_pronouns_bring_back_the_cast():
    board = build_storyboard("A fox sat on a hill. A girl sang. Then they danced together.")
    assert cast(board["scenes"][2]) == {"child": "dance", "fox": "dance"}


def test_world_state_carries_over_and_weather_clears_with_time():
    board = build_storyboard(
        "Rain fell on the village at night. A dog slept. In the morning a bird sang.")
    first, second, third = board["scenes"]
    assert (second["setting"], second["time"], second["weather"]) == ("village", "night", "rain")
    assert (third["time"], third["weather"]) == ("dawn", "clear")


def test_water_actors_force_a_water_setting():
    sc = scene("In the desert a camel walked. Then a boat appeared.")
    assert sc["setting"] in ("ocean", "lake")


def test_fell_asleep_is_sleep_not_fall():
    assert cast(scene("The dragon fell asleep."))["dragon"] == "sleep"


def test_abstract_text_becomes_motion_graphics():
    board = build_storyboard(
        "Attention is generosity. Productivity is motion without direction. "
        "Wisdom begins with deciding what to ignore.")
    assert all(s["abstract"] and not s["actors"] for s in board["scenes"])
    assert board["scenes"][1]["keywords"]


def test_long_text_is_grouped_and_durations_add_up():
    text = " ".join(f"The fox walked past tree number {i}." for i in range(30))
    board = build_storyboard(text, max_scenes=6, pace=2.0)
    assert len(board["scenes"]) == 6
    assert sum(len(s["captions"]) for s in board["scenes"]) == 30
    assert abs(board["duration"] - sum(s["duration"] for s in board["scenes"])) < 0.01
    assert board["duration"] == 2 * build_storyboard(text, max_scenes=6)["duration"]


def test_same_text_gives_same_storyboard():
    text = "A knight rode a horse into the mountains."
    assert build_storyboard(text) == build_storyboard(text)


def test_html_is_self_contained_and_escapes_story_text():
    html = render_html(build_storyboard('A fox said "</script><b>hi</b>" and ran.'))
    assert "__STORY_JSON__" not in html and "__VIEWER_JS__" not in html
    assert "</script><b>hi" not in html
    assert "http://" not in html.split("<script type=\"importmap\">")[0]


def test_sea_wins_over_other_places_and_town_becomes_scenery():
    sc = scene("The townspeople celebrate in the village by the sea.")
    assert sc["setting"] == "ocean"
    assert "house" in [p["kind"] for p in sc["props"]]


def test_compound_and_group_words_mean_several_people():
    for text in ("The townspeople celebrate.", "The villagers danced.",
                 "The fishermen sang.", "The townsfolk cheered."):
        people = [a for a in scene(text)["actors"] if a["kind"] == "person"]
        assert people and people[0]["count"] >= 3, text
    assert scene("The townspeople celebrate.")["setting"] == "village"
    assert not scene("The seasons changed.")["actors"]


def test_literal_mode_adds_nothing():
    sc = scene("Create a scene by the sea.")
    assert sc["setting"] == "ocean" and not sc["actors"] and not sc["props"]


def test_liberty_adds_background_life_but_never_changes_the_place():
    for take in range(8):
        sc = build_storyboard("Create a scene by the sea.", liberty=2, variation=take)["scenes"][0]
        assert sc["setting"] == "ocean"
        assert sc["actors"] and all(a["ambient"] for a in sc["actors"])
    takes = {str(build_storyboard("A scene by the sea.", liberty=2, variation=v)["scenes"])
             for v in range(8)}
    assert len(takes) > 1


def test_liberty_keeps_the_named_cast_and_is_repeatable():
    text = "A fox ran through the forest at night."
    a = build_storyboard(text, liberty=2, variation=3)
    assert a == build_storyboard(text, liberty=2, variation=3)
    main = [x for x in a["scenes"][0]["actors"] if not x["ambient"]]
    assert [(x["kind"], x["action"]) for x in main] == [("fox", "run")]
    assert a["scenes"][0]["time"] == "night"


def test_vocabulary_points_at_things_the_viewer_can_draw():
    import re
    from pathlib import Path
    from story3d import lexicon as L

    js = (Path(L.__file__).parent / "static" / "viewer.js").read_text()
    actor_bases = set(re.search(r"const BUILDERS = \{(.*?)\};", js, re.S).group(1)
                      .replace(":", " ").replace(",", " ").split())
    prop_bases = set(re.search(r"const PROP_BUILDERS = \{(.*?)\n  cactus \};", js, re.S)
                     .group(1).replace(":", " ").replace(",", " ").split()) | {"cactus"}
    assert {m["base"] for m in L.MODELS.values()} <= actor_bases
    assert {p["base"] for p in L.PROPS.values()} <= prop_bases
    assert set(L.ACTOR_WORDS.values()) <= set(L.MODELS)
    assert set(L.PROP_WORDS.values()) <= set(L.PROPS)
    assert {k for k, _ in L.COLLECTIVES.values()} <= set(L.MODELS)
    for options in L.AMBIENT.values():
        assert {k for k, _, _ in options} <= set(L.MODELS)
    for kinds in list(L.AMBIENT_PROPS.values()) + list(L.PLACE_DRESSING.values()):
        assert set(kinds) <= set(L.PROPS)


def test_style_is_passed_to_the_viewer():
    board = build_storyboard("A fox ran.")
    assert '"style": "2d"' in render_html(board, style="2d")
    assert '"style": "3d"' in render_html(board)


def test_the_slain_die_and_do_not_come_back_to_celebrate():
    board = build_storyboard("The pirate slayed the dragon. They danced and celebrated.")
    assert cast(board["scenes"][0]) == {"pirate": "slay", "dragon": "die"}
    assert cast(board["scenes"][1]) == {"pirate": "dance"}
    one = scene("The pirate slayed the dragon and the townspeople celebrated with them.")
    assert cast(one)["dragon"] == "die" and cast(one)["person"] == "jump"


def test_death_by_pronoun_passive_and_plain_dying():
    board = build_storyboard("A knight met a dragon. He slew it. He walked past the dragon.")
    assert cast(board["scenes"][1]) == {"knight": "slay", "dragon": "die"}
    assert cast(board["scenes"][2]) == {"knight": "walk", "dragon": "dead"}
    assert cast(scene("The king was killed by a wolf.")) == {"king": "die", "wolf": "slay"}
    assert cast(scene("The old king died.")) == {"king": "die"}


def test_an_ordinary_fight_kills_nobody():
    board = build_storyboard("The knight fought the dragon. Then they both slept.")
    assert cast(board["scenes"][0]) == {"knight": "fight", "dragon": "fight"}
    assert cast(board["scenes"][1]) == {"knight": "sleep", "dragon": "sleep"}


def rel(text):
    sc = scene(text)
    return ({a["kind"]: (a["action"], a["riding"], a["on"], (a["holding"] or {}).get("kind"))
             for a in sc["actors"]}, [p["kind"] for p in sc["props"]])


def test_riding_in_or_on_something():
    actors, _ = rel("A dog riding in a car.")
    assert actors == {"dog": ("ride", "car", None, None), "car": ("walk", None, None, None)}
    assert scene("A dog riding in a car.")["actors"][1]["model"]["open"] is True
    assert rel("The knight rode a horse.")[0]["knight"][:2] == ("ride", "horse")
    assert rel("A girl on a bicycle waved.")[0]["child"][:2] == ("ride", "bicycle")
    assert rel("A car driven by a dog.")[0]["dog"][:2] == ("ride", "car")
    flying = rel("A wizard flew on a dragon.")[0]
    assert flying["wizard"][:2] == ("ride", "dragon") and flying["dragon"][0] == "fly"
    both = rel("A dog and a cat drove a bus.")[0]
    assert both["dog"][1] == both["cat"][1] == "bus"


def test_passing_or_walking_beside_is_not_riding():
    assert rel("The knight rode past the dragon.")[0]["knight"][1] is None
    assert rel("A man walked on the beach with a horse.")[0]["person"][1] is None
    assert rel("The dog chased the car.")[0]["dog"][1] is None


def test_riders_stay_aboard_in_the_next_scene():
    board = build_storyboard("A dog rode in a car. Then they drove to the beach.")
    second = {a["kind"]: a for a in board["scenes"][1]["actors"]}
    assert second["dog"]["riding"] == "car" and second["dog"]["action"] == "ride"


def test_holding_things():
    actors, props = rel("A girl carried a basket and a dog carried a bone.")
    assert actors["child"][3] == "basket" and actors["dog"][3] == "bone" and props == []
    assert rel("The dog played with a ball.")[0]["dog"][3] == "ball"
    king = rel("The king sat on a horse holding a sword.")[0]
    assert king["king"][1] == "horse" and king["king"][3] == "sword"
    assert rel("A girl stood near a basket.")[1] == ["basket"]


def test_sitting_and_lying_on_furniture():
    actors, props = rel("A boy and a girl sat on a bench.")
    assert actors["child"][2] == "bench" and props == ["bench"]
    assert scene("A boy and a girl sat on a bench.")["actors"][0]["count"] == 2
    actors, props = rel("The king slept in the bed.")
    assert actors == {"king": ("sleep", None, "bed", None)} and props == ["bed"]


def meal(text, index=-1):
    return {a["kind"]: (a["action"], (a["food"] or {}).get("kind"), a["count"])
            for a in scene(text, index)["actors"]}


def test_eating_and_drinking():
    assert meal("The boy ate a hamburger.") == {"child": ("eat", "hamburger", 1)}
    assert meal("The girl drank a milkshake.") == {"child": ("drink", "milkshake", 1)}
    assert meal("The king had a coffee.")["king"] == ("drink", "coffee", 1)
    assert meal("The boy and the girl ate pizza.") == {"child": ("eat", "pizza", 2)}
    assert meal("A dog chewed a bone.")["dog"][:2] == ("eat", "bone")
    assert meal("The cow grazed in the meadow.")["cow"][:2] == ("eat", "grass")
    assert meal("The cat ate the fish.") == {"cat": ("eat", "fish", 1)}   # the fish is food here


def test_meals_bring_a_table_and_a_plate():
    sc = scene("The family had dinner at the table.")
    assert sc["actors"][0]["action"] == "eat" and sc["actors"][0]["food"]["kind"] == "noodles"
    assert [p["kind"] for p in sc["props"]] == ["table"]
    assert meal("The kids had breakfast.")["child"][1] == "pancakes"


def test_only_the_eaters_eat():
    got = meal("The dog chased the cat and the boy ate a hamburger.")
    assert got["child"] == ("eat", "hamburger", 1)
    assert got["dog"][0] == "run" and got["cat"][0] != "eat"


def test_feeding_and_being_eaten():
    got = meal("The girl fed the ducks bread.")
    assert got["child"][:2] == ("feed", "bread") and got["duck"][:2] == ("eat", "bread")
    assert {k: v[0] for k, v in meal("The wolf ate the pig.").items()} == {"wolf": "slay", "pig": "die"}


def test_food_nobody_eats_is_held_or_on_the_table():
    sc = scene("A boy with a hamburger walked.")
    assert sc["actors"][0]["holding"]["kind"] == "hamburger" and sc["actors"][0]["holding"]["food"]
    sc = scene("There was a pizza on the table.")
    assert sc["props"] == [{**sc["props"][0], "kind": "table", "items": ["pizza"]}]
    assert scene("An orange cat slept.")["actors"][0]["food"] is None


def test_pronoun_subjects_with_nobody_introduced():
    assert meal("They ate cookies.") == {"person": ("eat", "cookie", 2)}


def test_fighters_have_sides():
    def sides(text):
        return {a["kind"]: (a["count"], a["side"]) for a in scene(text)["actors"]}
    assert sides("The knight fought the dragon.") == {"knight": (1, 0), "dragon": (1, 1)}
    assert sides("Two knights fought a giant.") == {"knight": (2, 0), "giant": (1, 1)}
    assert sides("The cat and the dog had a fight.") == {"cat": (1, 0), "dog": (1, 1)}
    assert sides("The king was killed by a wolf.") == {"king": (1, 0), "wolf": (1, 1)}
    # different words for the same kind of character are different characters
    assert sides("The pirate and the ninja fought.") == {"pirate": (2, 0)}


def test_a_mounted_fighter_rides_into_battle():
    actors = {a["kind"]: a for a in scene("The knight on a horse fought the dragon.")["actors"]}
    assert actors["knight"]["riding"] == "horse" and actors["knight"]["holding"]["kind"] == "sword"
    assert actors["horse"]["action"] == "fight" and actors["dragon"]["action"] == "fight"


def test_every_food_and_weapon_can_be_drawn():
    import re
    from pathlib import Path
    from story3d import lexicon as L

    js = (Path(L.__file__).parent / "static" / "viewer.js").read_text()
    makers = set(re.findall(r"^  (\w+)(?:\(\)|: \(\) =>)", js.split("const FOOD_MAKERS = {")[1].split("\n};")[0], re.M))
    assert set(L.FOOD) <= makers, set(L.FOOD) - makers
    for table in (L.MEAL_FOOD, L.EATER_FOOD, L.DRINKER_FOOD, L.EDIBLE_ACTORS):
        assert set(table.values()) <= set(L.FOOD)
    weapons = {m.get("weapon") for m in L.MODELS.values()} - {None}
    assert weapons <= {"sword", "axe", "club", "staff", "blaster", "fist"}
