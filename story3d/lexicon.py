"""Vocabulary that maps plain words onto things the 3D viewer can draw.

Everything the parser understands lives here. To teach the app a new word,
add it to one of the tables below; to add a new *look*, add an entry to
MODELS (actors) or PROPS that reuses one of the viewer's base builders.
"""

from __future__ import annotations


def _words(table: dict[str, str]) -> dict[str, str]:
    """{"kind": "word word"} -> {"word": "kind"}"""
    return {w: kind for kind, ws in table.items() for w in ws.split()}


# --------------------------------------------------------------------------
# Actors: canonical kind -> render spec understood by viewer.js
#   base:    person | robot | quad | bird | fish | boat | car | rocket | plane
#   default: action used when no verb is found near the actor
#   implies: setting suggested when the story has not named one
#   water:   actor needs a water setting (ocean / lake)
# --------------------------------------------------------------------------
MODELS: dict[str, dict] = {
    "person": {"base": "person"},
    "child": {"base": "person", "scale": 0.68},
    "king": {"base": "person", "crown": True, "color": "#8e2c3b"},
    "queen": {"base": "person", "crown": True, "robe": True, "color": "#6b3fa0"},
    "wizard": {"base": "person", "hat": True, "robe": True, "color": "#3b4cc0"},
    "witch": {"base": "person", "hat": True, "robe": True, "color": "#2c2433"},
    "knight": {"base": "person", "armor": True, "color": "#aab4c0"},
    "pirate": {"base": "person", "color": "#2f2f38"},
    "astronaut": {"base": "person", "bigHead": True, "color": "#f1f3f5",
                  "skin": "#cfe3f5", "implies": "space"},
    "alien": {"base": "person", "bigHead": True, "color": "#3f9b6c",
              "skin": "#8fe38f", "scale": 0.8, "implies": "space"},
    "giant": {"base": "person", "scale": 2.3, "color": "#7a5c3e"},
    "monster": {"base": "person", "scale": 1.8, "bigHead": True,
                "color": "#4a2d5e", "skin": "#7fae6a"},
    "ghost": {"base": "person", "robe": True, "ghost": True,
              "color": "#eef2ff", "skin": "#eef2ff"},
    "fairy": {"base": "person", "scale": 0.45, "color": "#f39ac7", "default": "fly"},
    "monkey": {"base": "person", "scale": 0.7, "color": "#6b4a2f", "skin": "#8a6240"},
    "robot": {"base": "robot"},
    # four-legged
    "dog": {"base": "quad", "color": "#b0793f", "len": 0.9, "leg": 0.4, "ears": "round"},
    "cat": {"base": "quad", "color": "#e39a3b", "len": 0.7, "leg": 0.28, "width": 0.3,
            "ears": "up", "tail": 0.6},
    "horse": {"base": "quad", "color": "#7b4a2a", "len": 1.7, "leg": 0.95, "width": 0.55,
              "neck": 0.55, "ears": "up", "tail": 0.7},
    "unicorn": {"base": "quad", "color": "#f4f1f8", "len": 1.7, "leg": 0.95, "width": 0.55,
                "neck": 0.55, "ears": "up", "tail": 0.7, "horn": True},
    "fox": {"base": "quad", "color": "#d9662b", "len": 0.8, "leg": 0.32, "width": 0.3,
            "ears": "up", "tail": 0.7},
    "wolf": {"base": "quad", "color": "#7d838c", "len": 1.1, "leg": 0.5, "ears": "up",
             "tail": 0.6},
    "bear": {"base": "quad", "color": "#5a3b25", "len": 1.5, "leg": 0.55, "width": 0.8,
             "ears": "round", "tail": 0.12},
    "rabbit": {"base": "quad", "color": "#e9e4dc", "len": 0.45, "leg": 0.2, "width": 0.26,
               "ears": "long", "tail": 0.1},
    "deer": {"base": "quad", "color": "#a9773f", "len": 1.2, "leg": 0.8, "width": 0.4,
             "neck": 0.4, "ears": "up", "tail": 0.15, "horn": True},
    "sheep": {"base": "quad", "color": "#f1ede4", "len": 0.9, "leg": 0.35, "width": 0.55,
              "ears": "round", "tail": 0.12},
    "cow": {"base": "quad", "color": "#efe9df", "len": 1.5, "leg": 0.6, "width": 0.65,
            "ears": "round", "tail": 0.6},
    "pig": {"base": "quad", "color": "#f0a6a6", "len": 0.9, "leg": 0.25, "width": 0.5,
            "ears": "up", "tail": 0.15},
    "lion": {"base": "quad", "color": "#d6a24a", "len": 1.4, "leg": 0.6, "width": 0.55,
             "ears": "round", "tail": 0.8},
    "tiger": {"base": "quad", "color": "#e8872b", "len": 1.4, "leg": 0.55, "width": 0.5,
              "ears": "round", "tail": 0.8},
    "elephant": {"base": "quad", "color": "#8c9099", "len": 2.2, "leg": 1.1, "width": 1.2,
                 "ears": "round", "tail": 0.5, "trunk": True},
    "mouse": {"base": "quad", "color": "#a7a39c", "len": 0.3, "leg": 0.1, "width": 0.18,
              "ears": "round", "tail": 0.4},
    "camel": {"base": "quad", "color": "#c9a063", "len": 1.7, "leg": 1.1, "width": 0.6,
              "neck": 0.7, "ears": "round", "tail": 0.4, "implies": "desert"},
    "turtle": {"base": "quad", "color": "#5d8a4a", "len": 0.6, "leg": 0.1, "width": 0.5,
               "tail": 0.1, "speed": 0.3},
    "dinosaur": {"base": "quad", "color": "#4f8a55", "len": 3.0, "leg": 1.3, "width": 1.0,
                 "neck": 1.0, "tail": 2.0, "scale": 1.4},
    "dragon": {"base": "quad", "color": "#b5342b", "len": 2.6, "leg": 0.8, "width": 0.9,
               "neck": 0.8, "ears": "up", "tail": 1.8, "wings": True, "default": "fly"},
    # flyers
    "bird": {"base": "bird", "color": "#3f88c5", "default": "fly"},
    "owl": {"base": "bird", "color": "#7a5a3a", "scale": 1.3, "default": "fly"},
    "crow": {"base": "bird", "color": "#1d1d24", "default": "fly"},
    "eagle": {"base": "bird", "color": "#5b4030", "scale": 1.8, "default": "fly"},
    "butterfly": {"base": "bird", "color": "#f2a541", "scale": 0.35, "default": "fly"},
    "bat": {"base": "bird", "color": "#2b2433", "scale": 0.7, "default": "fly"},
    "penguin": {"base": "bird", "color": "#1f2530", "scale": 1.6, "implies": "snow"},
    # swimmers
    "fish": {"base": "fish", "color": "#f28c38", "default": "swim", "water": True,
             "implies": "ocean"},
    "shark": {"base": "fish", "color": "#7f8a96", "scale": 2.6, "default": "swim",
              "water": True, "implies": "ocean"},
    "dolphin": {"base": "fish", "color": "#6f9ccf", "scale": 2.0, "default": "swim",
                "water": True, "implies": "ocean"},
    "whale": {"base": "fish", "color": "#3b5b8c", "scale": 5.0, "default": "swim",
              "water": True, "implies": "ocean"},
    # vehicles
    "boat": {"base": "boat", "default": "walk", "water": True, "implies": "ocean",
             "speed": 1.3},
    "car": {"base": "car", "speed": 3.0, "implies": "city"},
    "rocket": {"base": "rocket", "default": "fly"},
    "plane": {"base": "plane", "default": "fly"},
}

ACTOR_WORDS = _words({
    "person": "man woman person stranger traveler traveller farmer fisherman doctor "
              "teacher student mother father mom dad friend brother sister hunter "
              "merchant thief hero heroine neighbor neighbour villager explorer sailor "
              "captain musician painter artist baker writer scientist engineer worker "
              "pilot grandmother grandfather grandma grandpa husband wife uncle aunt "
              "lady gentleman shepherd monk priest nurse inventor gardener woodcutter "
              "miller tailor messenger servant maid cook poet",
    "child": "child kid boy girl baby son daughter toddler orphan",
    "king": "king emperor prince lord sultan",
    "queen": "queen empress princess",
    "wizard": "wizard sorcerer mage magician",
    "witch": "witch sorceress",
    "knight": "knight soldier warrior guard guardian samurai",
    "pirate": "pirate bandit ninja",
    "astronaut": "astronaut cosmonaut",
    "alien": "alien martian",
    "giant": "giant ogre troll",
    "monster": "monster beast creature demon goblin",
    "ghost": "ghost spirit phantom",
    "fairy": "fairy pixie angel",
    "monkey": "monkey ape gorilla chimpanzee",
    "robot": "robot android droid",
    "dog": "dog puppy hound",
    "cat": "cat kitten",
    "horse": "horse pony stallion mare donkey mule",
    "unicorn": "unicorn",
    "fox": "fox",
    "wolf": "wolf coyote",
    "bear": "bear",
    "rabbit": "rabbit bunny hare",
    "deer": "deer stag fawn reindeer moose",
    "sheep": "sheep lamb goat",
    "cow": "cow bull ox cattle calf buffalo",
    "pig": "pig piglet boar",
    "lion": "lion lioness",
    "tiger": "tiger leopard panther cheetah jaguar",
    "elephant": "elephant mammoth rhino hippo",
    "mouse": "mouse rat squirrel hamster hedgehog",
    "camel": "camel",
    "turtle": "turtle tortoise frog toad lizard crab snail",
    "dinosaur": "dinosaur",
    "dragon": "dragon",
    "bird": "bird sparrow robin dove pigeon swallow seagull gull parrot duck goose "
            "swan chicken hen rooster songbird",
    "owl": "owl",
    "crow": "crow raven",
    "eagle": "eagle hawk falcon vulture",
    "butterfly": "butterfly bee moth dragonfly firefly",
    "bat": "bat",
    "penguin": "penguin",
    "fish": "fish salmon trout goldfish",
    "shark": "shark",
    "dolphin": "dolphin",
    "whale": "whale",
    "boat": "boat ship sailboat canoe raft vessel yacht ferry",
    "car": "car truck bus taxi van jeep wagon cart carriage",
    "rocket": "rocket spaceship spacecraft shuttle starship",
    "plane": "plane airplane aeroplane aircraft jet",
})

# word -> (kind, how many to draw)
COLLECTIVES: dict[str, tuple[str, int]] = {
    "people": ("person", 4), "crowd": ("person", 5), "family": ("person", 3),
    "villagers": ("person", 4), "everyone": ("person", 4), "everybody": ("person", 4),
    "army": ("knight", 5), "soldiers": ("knight", 4), "children": ("child", 3),
    "flock": ("bird", 5), "herd": ("cow", 4), "pack": ("wolf", 4), "fleet": ("boat", 3),
    "crew": ("person", 4), "team": ("person", 4), "tribe": ("person", 5),
}

# --------------------------------------------------------------------------
# Props: canonical kind -> {"base": viewer builder, "r": distance from stage}
# --------------------------------------------------------------------------
PROPS: dict[str, dict] = {
    "house": {"base": "house", "r": 9},
    "castle": {"base": "castle", "r": 24},
    "tower": {"base": "tower", "r": 14},
    "tent": {"base": "tent", "r": 6.5},
    "campfire": {"base": "campfire", "r": 2.6},
    "chest": {"base": "chest", "r": 2.4},
    "crystal": {"base": "crystal", "r": 3},
    "lamp": {"base": "lamp", "r": 3.4},
    "tree": {"base": "tree", "r": 6},
    "rock": {"base": "rock", "r": 5},
    "flower": {"base": "flowers", "r": 2.8},
    "cactus": {"base": "cactus", "r": 5, "implies": "desert"},
}

PROP_WORDS = _words({
    "house": "house cottage hut cabin school shop store church barn inn tavern "
             "library temple farmhouse bakery mill",
    "castle": "castle palace fortress citadel",
    "tower": "tower lighthouse beacon",
    "tent": "tent camp campsite",
    "campfire": "fire campfire bonfire flame",
    "chest": "treasure chest gold box",
    "crystal": "crystal gem diamond jewel ruby emerald orb",
    "lamp": "lamp lantern lamppost streetlight candle",
    "tree": "tree oak pine willow",
    "rock": "rock stone boulder cave",
    "flower": "flower roses tulip daisy blossom bloom",
    "cactus": "cactus",
})

# --------------------------------------------------------------------------
# World
# --------------------------------------------------------------------------
SETTING_WORDS = _words({
    "forest": "forest woods jungle grove rainforest woodland",
    "ocean": "ocean sea beach shore island coast harbor harbour bay seaside",
    "lake": "lake pond river stream creek waterfall swamp marsh",
    "city": "city street skyscraper downtown metropolis subway apartment traffic "
            "sidewalk avenue",
    "village": "village town hamlet market farm",
    "desert": "desert dune oasis canyon",
    "mountain": "mountain peak summit cliff hill valley volcano",
    "snow": "arctic tundra glacier iceberg winter",
    "space": "space planet galaxy universe cosmos asteroid mars",
    "meadow": "meadow field garden park prairie countryside pasture",
})
WATER_SETTINGS = {"ocean", "lake"}

TIME_WORDS = _words({
    "night": "night midnight moon moonlight moonlit star starlight starry nightfall",
    "sunset": "evening dusk sunset twilight",
    "dawn": "morning dawn sunrise daybreak",
    "day": "day noon afternoon sun sunny sunlight sunshine daylight",
})

WEATHER_WORDS = _words({
    "rain": "rain rainy drizzle downpour raindrop",
    "storm": "storm thunder lightning tempest hurricane thunderstorm",
    "snow": "snow snowy blizzard snowflake frost snowfall",
    "fog": "fog mist haze foggy misty",
    "clear": "sunny sunshine cloudless",
})

ACTION_WORDS = _words({
    "walk": "walk go wander stroll travel journey march hike follow come return "
            "leave arrive enter approach explore cross roam trek move carry lead "
            "creep sneak sail drive ride set",
    "run": "run race rush chase flee hurry dash sprint escape charge gallop bolt",
    "fly": "fly soar glide float hover ascend swoop flutter launch",
    "jump": "jump leap hop bounce cheer celebrate",
    "dance": "dance spin twirl sing play laugh",
    "swim": "swim dive paddle splash",
    "sleep": "sleep rest dream nap doze snore",
    "fall": "fall collapse tumble trip stumble faint die",
    "talk": "talk say speak tell ask whisper shout argue reply answer greet meet "
            "call explain discuss chat promise agree",
    "fight": "fight battle attack strike struggle wrestle duel defeat slay",
    "look": "look search watch see find discover stare gaze notice seek spot",
    "idle": "sit wait stand stay kneel think read pray listen",
})
VEHICLES = {"boat", "car", "rocket", "plane"}
PHYSICAL_ACTIONS = {"walk", "run", "fly", "jump", "dance", "swim", "sleep", "fall", "fight"}

MOOD_WORDS = _words({
    "joyful": "happy joy laugh smile love beautiful wonderful bright celebrate delight "
              "glad cheer warm hope fun sing dance golden victory merry proud",
    "sad": "sad cry weep tear lonely alone lost grief sorrow mourn death die dead "
           "empty farewell goodbye broken pain hurt miss",
    "tense": "fear afraid danger scream chase monster fight battle war attack terror "
             "panic suddenly escape threat angry rage enemy trap roar storm flee",
    "mysterious": "mystery mysterious strange secret magic magical ancient whisper "
                  "shadow hidden unknown dream ghost enchanted curious wonder mist "
                  "spell eerie",
    "calm": "calm quiet peace peaceful gentle soft still slow rest sleep serene "
            "breeze tranquil",
})

IRREGULAR = {
    "ran": "run", "flew": "fly", "flown": "fly", "swam": "swim", "swum": "swim",
    "fell": "fall", "fallen": "fall", "slept": "sleep", "sang": "sing", "sung": "sing",
    "went": "go", "gone": "go", "came": "come", "fought": "fight", "rode": "ride",
    "drove": "drive", "saw": "see", "seen": "see", "found": "find", "stood": "stand",
    "sat": "sit", "leapt": "leap", "wept": "weep", "dove": "dive", "fled": "flee",
    "crept": "creep", "met": "meet", "said": "say", "told": "tell", "spoke": "speak",
    "left": "leave", "led": "lead", "died": "die", "dying": "die", "lying": "lie",
    "running": "run", "swimming": "swim", "sitting": "sit", "set": "set",
    "wolves": "wolf", "children": "child", "men": "man", "women": "woman",
    "mice": "mouse", "geese": "goose", "knives": "knife", "fairies": "fairy",
    "heard": "listen", "thought": "think", "laughed": "laugh",
}
IRREGULAR_PLURALS = {"wolves", "men", "women", "mice", "geese", "fairies", "cattle"}

# Words that look like a vocabulary hit after stemming but are not.
IGNORE = {"hoped", "hoping", "hope's", "was", "has", "his", "its", "this", "as", "us",
          "does", "goes", "going", "set", "bass", "boxing", "moved", "still", "left",
          "like", "liked", "can", "may", "might", "will", "well", "back", "even"}

NUMBERS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 5, "seven": 5,
           "several": 4, "many": 5, "few": 3, "both": 2, "couple": 2, "dozen": 5,
           "hundred": 5, "thousand": 5}

PRONOUNS = {"he", "she", "they", "him", "her", "them", "his", "their", "hers", "theirs"}
SUBJECT_PRONOUNS = {"he", "she", "they"}
FIRST_PERSON = {"i", "we", "me", "us", "my", "our"}
PLACE_PREPS = {"in", "to", "from", "at", "of", "near", "across", "through", "toward",
               "towards", "into", "on"}

STOPWORDS = set("""
a about above after again against all almost also although always am among an and
another any are around as at away be became because become been before began behind
being below beneath beside between beyond both but by came can cannot could did do
does doing done down during each either else ever every few for from further had
has have having he her here hers herself him himself his how however i if in into
is it its itself just like many may me might more most much must my myself near
never no nor not nothing now of off often on once one only onto or other our ours
out over own perhaps rather same she should since so some something soon still such
than that the their theirs them themselves then there these they this those though
through thus to too toward towards under until up upon us very was we were what
when where whether which while who whom whose why will with within without would
yes yet you your yours yourself one two three four five first last next long little
big small old new young good great made make makes get got let said says tell
every everything anything today tomorrow yesterday monday tuesday wednesday thursday
friday saturday sunday january february march april june july august september
october november december mr mrs ms dr sir oh ah hello yes okay
""".split())
