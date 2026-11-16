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
