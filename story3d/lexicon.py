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
    "cow": {"base": "quad", "pattern": "spots", "color": "#efe9df", "len": 1.5, "leg": 0.6, "width": 0.65,
            "ears": "round", "tail": 0.6},
    "pig": {"base": "quad", "color": "#f0a6a6", "len": 0.9, "leg": 0.25, "width": 0.5,
            "ears": "up", "tail": 0.15},
    "lion": {"base": "quad", "mane": True, "color": "#d6a24a", "len": 1.4, "leg": 0.6, "width": 0.55,
             "ears": "round", "tail": 0.8},
    "tiger": {"base": "quad", "pattern": "stripes", "ink": "#2a1a0a", "color": "#e8872b", "len": 1.4, "leg": 0.55, "width": 0.5,
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
    "dragon": {"base": "quad", "breath": True, "color": "#b5342b", "len": 2.6, "leg": 0.8, "width": 0.9,
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
    "car": {"base": "car", "speed": 3.0, "implies": "city", "default": "walk"},
    "rocket": {"base": "rocket", "default": "fly"},
    "plane": {"base": "plane", "default": "fly"},
}

ACTOR_WORDS = _words({
    "person":
        "man woman person stranger traveler traveller farmer fisherman doctor "
        "teacher student mother father mom dad mum mama papa parent friend "
        "brother sister sibling cousin hunter merchant thief hero heroine "
        "neighbor neighbour villager explorer sailor captain musician painter "
        "artist baker writer author scientist engineer worker pilot grandmother "
        "grandfather grandma grandpa grandparent husband wife uncle aunt lady "
        "gentleman cowboy shepherd nurse inventor gardener woodcutter "
        "lumberjack miller tailor messenger servant maid poet singer "
        "dancer actor actress athlete runner swimmer climber hiker camper "
        "tourist visitor guest customer shopkeeper vendor trader seller builder "
        "carpenter blacksmith smith miner driver rider passenger pedestrian "
        "citizen townsman peasant nomad pilgrim wanderer adventurer detective "
        "spy journalist reporter photographer lawyer mayor president "
        "leader chief boss manager clerk secretary officer programmer coder "
        "designer architect professor scholar librarian historian philosopher "
        "scientist astronomer biologist chemist mathematician beggar refugee "
        "prisoner slave rebel villain bully stranger crowd human adult teenager "
        "teen youth elder lover couple partner girlfriend boyfriend fiance "
        "bride groom widow twin companion ally rival enemy opponent "
        "foe ranger lifeguard fireman firefighter postman mailman "
        "waiter waitress barber butcher jeweler potter weaver sculptor "
        "conductor drummer guitarist pianist violinist apprentice mentor "
        "pupil classmate colleague coworker teammate player referee "
        "champion somebody someone nobody anyone guy dude chap bloke gal "
        "maiden lad lass fisher boatman ferryman oarsman dweller inhabitant "
        "resident settler pioneer",
    "child":
        "child kid boy girl baby son daughter toddler orphan infant schoolboy "
        "schoolgirl youngster newborn grandchild grandson granddaughter nephew "
        "niece",
    "king":
        "king emperor prince lord sultan pharaoh monarch ruler duke baron tsar "
        "czar chieftain",
    "queen":
        "queen empress princess duchess",
    "wizard":
        "wizard sorcerer mage magician warlock enchanter alchemist druid shaman "
        "prophet oracle seer sage",
    "witch":
        "witch sorceress enchantress hag crone",
    "knight":
        "knight soldier warrior guard guardian samurai gladiator paladin sentry "
        "trooper marine general commander sergeant swordsman archer viking "
        "spartan legionnaire",
    "pirate":
        "pirate bandit ninja robber burglar outlaw smuggler assassin buccaneer "
        "raider mercenary",
    "astronaut":
        "astronaut cosmonaut spaceman",
    "alien":
        "alien martian extraterrestrial",
    "giant":
        "giant ogre troll titan cyclops colossus",
    "monster":
        "monster beast creature demon goblin orc fiend werewolf yeti bigfoot "
        "kraken ghoul",
    "ghost":
        "ghost spirit phantom specter spectre wraith apparition poltergeist "
        "",
    "fairy":
        "fairy pixie sprite nymph faerie",
    "angel":
        "angel cherub seraph",
    "monkey":
        "monkey ape gorilla chimpanzee chimp baboon orangutan lemur",
    "robot":
        "robot android droid cyborg automaton bot ",
    "vampire":
        "vampire dracula",
    "zombie":
        "zombie undead mummy",
    "skeleton":
        "skeleton",
    "santa":
        "santa",
    "elf":
        "elf leprechaun gnome imp",
    "dwarf":
        "dwarf hobbit halfling",
    "clown":
        "clown jester juggler acrobat mime",
    "mermaid":
        "mermaid merman siren",
    "chef":
        "chef",
    "police":
        "police policeman policewoman cop sheriff constable",
    "priest":
        "priest monk nun bishop pope cleric friar rabbi imam pastor vicar",
    "devil":
        "devil satan",
    "superhero":
        "superhero",
    "scarecrow":
        "scarecrow",
    "dog":
        "dog puppy hound bulldog pup terrier poodle retriever spaniel collie "
        "mutt beagle husky corgi labrador dachshund",
    "cat":
        "cat kitten kitty tomcat feline tabby",
    "horse":
        "horse pony stallion mare foal colt steed",
    "donkey":
        "donkey mule burro",
    "zebra":
        "zebra",
    "unicorn":
        "unicorn",
    "pegasus":
        "pegasus",
    "fox":
        "fox vixen jackal",
    "wolf":
        "wolf coyote hyena",
    "bear":
        "bear grizzly",
    "panda":
        "panda",
    "rabbit":
        "rabbit bunny hare",
    "kangaroo":
        "kangaroo wallaby",
    "deer":
        "deer stag fawn reindeer moose elk antelope gazelle",
    "sheep":
        "sheep lamb ewe",
    "goat":
        "goat ram",
    "llama":
        "llama alpaca",
    "cow":
        "cow bull ox cattle calf buffalo bison yak",
    "pig":
        "pig piglet boar hog swine",
    "lion":
        "lion lioness",
    "griffin":
        "griffin gryphon sphinx chimera",
    "tiger":
        "tiger leopard panther cheetah jaguar cougar puma lynx bobcat",
    "elephant":
        "elephant mammoth",
    "rhino":
        "rhino rhinoceros hippo hippopotamus",
    "giraffe":
        "giraffe",
    "mouse":
        "mouse rat hamster hedgehog mole gerbil shrew vole",
    "squirrel":
        "squirrel chipmunk raccoon skunk beaver otter weasel ferret badger "
        "mongoose meerkat possum",
    "camel":
        "camel",
    "turtle":
        "turtle tortoise snail armadillo",
    "frog":
        "frog toad",
    "crocodile":
        "crocodile alligator lizard iguana gecko chameleon salamander newt "
        "snake serpent python cobra viper",
    "crab":
        "crab lobster scorpion spider beetle ant bug insect ladybug cricket "
        "grasshopper caterpillar",
    "dinosaur":
        "dinosaur tyrannosaurus raptor brontosaurus",
    "dragon":
        "dragon wyvern drake hydra",
    "bird":
        "bird sparrow robin dove pigeon swallow songbird finch bluebird lark "
        "nightingale starling wren jay bluejay canary thrush",
    "seagull":
        "seagull gull albatross pelican tern stork heron egret",
    "duck":
        "duck duckling goose gosling",
    "swan":
        "swan",
    "chicken":
        "chicken hen rooster turkey chick",
    "parrot":
        "parrot macaw toucan cockatoo parakeet",
    "flamingo":
        "flamingo",
    "peacock":
        "peacock",
    "phoenix":
        "phoenix firebird",
    "owl":
        "owl",
    "crow":
        "crow raven magpie blackbird",
    "eagle":
        "eagle hawk falcon vulture condor osprey",
    "butterfly":
        "butterfly moth dragonfly firefly",
    "bee":
        "bee wasp hornet bumblebee hummingbird",
    "bat":
        "bat",
    "penguin":
        "penguin puffin",
    "fish":
        "fish salmon trout goldfish tuna cod carp minnow sardine herring eel "
        "piranha clownfish",
    "shark":
        "shark barracuda swordfish",
    "dolphin":
        "dolphin porpoise seal walrus",
    "whale":
        "whale orca leviathan",
    "octopus":
        "octopus squid jellyfish",
    "submarine":
        "submarine",
    "boat":
        "boat ship sailboat canoe raft vessel yacht ferry kayak rowboat dinghy "
        "galleon schooner steamer tugboat barge gondola liner frigate lifeboat",
    "car":
        "car truck bus taxi van jeep wagon cart carriage automobile cab "
        "limousine pickup tractor train tram locomotive coach chariot "
        "stagecoach ambulance sedan motorcar",
    "rocket":
        "rocket spaceship spacecraft shuttle starship missile",
    "ufo":
        "ufo saucer",
    "plane":
        "plane airplane aeroplane aircraft jet helicopter airliner biplane "
        "glider chopper",
    "balloon":
        "blimp airship zeppelin",
})

# word -> (kind, how many to draw)
COLLECTIVES: dict[str, tuple[str, int]] = {
    "people": ("person", 4), "crowd": ("person", 5), "family": ("person", 3),
    "villagers": ("person", 5), "townsfolk": ("person", 5), "folk": ("person", 4),
    "folks": ("person", 4), "citizens": ("person", 5), "audience": ("person", 5),
    "guests": ("person", 4), "neighbors": ("person", 4), "neighbours": ("person", 4), "everyone": ("person", 4), "everybody": ("person", 4),
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
    "house":
        "house cottage hut cabin school shop store church barn inn tavern "
        "library temple farmhouse bakery mill mansion villa bungalow lodge "
        "shack shed hostel hotel motel pub cafe restaurant diner bookstore "
        "pharmacy hospital clinic museum theater theatre cinema stable workshop "
        "forge smithy chapel cathedral monastery mosque orphanage dormitory "
        "townhall homestead cottage schoolhouse boathouse greenhouse storehouse "
        "warehouse garage bungalow dwelling residence abode hovel lodge saloon",
    "castle":
        "castle palace fortress citadel kingdom stronghold throne fort",
    "tower":
        "tower lighthouse beacon turret spire steeple minaret watchtower "
        "belltower",
    "tent":
        "tent camp campsite teepee tipi yurt pavilion marquee campground",
    "campfire":
        "fire campfire bonfire flame blaze embers hearth fireplace firewood "
        "inferno",
    "chest":
        "treasure chest gold box coffer loot coins riches suitcase "
        "luggage gift parcel package",
    "crystal":
        "crystal gem diamond jewel ruby emerald orb gemstone sapphire amethyst "
        "pearl opal relic artifact amulet talisman prism portal",
    "lamp":
        "lamp lantern lamppost streetlight candle torch streetlamp lightbulb",
    "tree":
        "tree oak pine willow birch maple cedar palm spruce elm redwood sapling "
        "stump",
    "rock":
        "rock stone boulder cave pebble meteorite rubble cavern grotto",
    "flower":
        "flower roses tulip daisy blossom bloom lily orchid sunflower poppy "
        "lavender daffodil petal bouquet wildflower lotus",
    "cactus":
        "cactus",
    "bridge":
        "bridge footbridge drawbridge overpass viaduct",
    "fence":
        "fence gate railing palisade barricade",
    "well":
        "wishing bucket",
    "statue":
        "statue monument sculpture idol memorial obelisk ruins pillar totem",
    "windmill":
        "windmill turbine",
    "bench":
        "bench chair stool sofa couch armchair",
    "fountain":
        "fountain geyser",
    "grave":
        "grave tomb tombstone gravestone headstone coffin crypt",
    "snowman":
        "snowman",
    "table":
        "table desk picnic feast banquet altar dinner supper lunch breakfast "
        "meal",
    "flag":
        "flag banner pennant bunting flagpole",
    "barrel":
        "barrel crate keg cask cargo",
    "mushroom":
        "mushroom toadstool fungus",
    "stall":
        "stall booth kiosk",
    "pyramid":
        "pyramid ziggurat",
    "igloo":
        "igloo",
    "bush":
        "bush shrub hedge bramble",
    "signpost":
        "signpost billboard crossroads",
    "pumpkin":
        "pumpkin melon",
})

# --------------------------------------------------------------------------
# World
# --------------------------------------------------------------------------
SETTING_WORDS = _words({
    "forest":
        "forest woods jungle grove rainforest woodland timberland bamboo "
        "wilderness backwoods canopy wildwood treeline",
    "ocean":
        "ocean sea beach shore island coast harbor harbour bay seaside seashore "
        "shoreline coastline waterfront oceanside seafront lagoon reef pier "
        "dock cove gulf strait atoll archipelago marina wharf jetty boardwalk "
        "cape port isle",
    "lake":
        "lake pond river stream creek waterfall swamp marsh brook riverbank "
        "lakeside lakeshore reservoir canal bayou wetland rapids delta estuary "
        "fjord loch moat bog riverside",
    "city":
        "city street skyscraper downtown metropolis subway apartment traffic "
        "sidewalk avenue cityscape urban alley boulevard mall highway freeway "
        "intersection airport factory paris london tokyo rome berlin chicago "
        "manhattan brooklyn shanghai mumbai dubai sydney toronto boston seattle "
        "rooftop",
    "village":
        "village town hamlet market farm township settlement ranch farmstead "
        "farmyard barnyard bazaar fairground marketplace parish outpost colony "
        "neighborhood neighbourhood suburb plaza",
    "desert":
        "desert dune oasis canyon sahara wasteland badlands mesa savanna "
        "savannah outback gobi mojave safari",
    "mountain":
        "mountain peak summit cliff hill valley volcano alps himalaya everest "
        "highland crag plateau gorge ravine foothill hillside hilltop "
        "mountaintop mountainside glen rockies andes",
    "snow":
        "arctic tundra glacier iceberg winter antarctica antarctic siberia "
        "icecap snowfield permafrost alaska greenland wintertime",
    "space":
        "space planet galaxy universe cosmos asteroid mars nebula lunar jupiter "
        "saturn venus neptune pluto constellation interstellar comet meteor "
        "spaceport moonbase",
    "meadow":
        "meadow field garden park prairie countryside pasture grassland lawn "
        "yard backyard courtyard playground orchard vineyard farmland "
        "steppe heath moor glade clearing paddock cemetery graveyard",
})
WATER_SETTINGS = {"ocean", "lake"}

# Weak clues: they pick the place only when the text never names one.
HINT_WORDS = _words({
    "ocean": "waves tide surf seashell seagull gull sailor sail anchor salty mermaid",
    "forest": "leaf branch moss mushroom undergrowth thicket",
    "city": "neon office pavement crowd skyline",
    "snow": "ice icy frozen sled igloo",
    "space": "orbit rocket spaceship stars",
    "village": "townspeople townsfolk villager festival fair",
    "desert": "sand scorching mirage",
    "mountain": "climb ridge slope",
})

# When a sentence names two places ("a village by the sea"), the second one
# is kept as scenery inside the first.
SETTING_PROPS = {"village": "house", "forest": "tree", "desert": "cactus",
                 "meadow": "flower", "city": "lamp"}

# ---- creative liberty: life and set dressing the text did not ask for ------
# setting -> [(kind, action, how many)]
AMBIENT: dict[str, list[tuple[str, str, int]]] = {
    "ocean": [("boat", "walk", 1), ("bird", "fly", 3), ("dolphin", "swim", 2),
              ("person", "walk", 1), ("whale", "swim", 1), ("child", "dance", 2)],
    "lake": [("boat", "walk", 1), ("bird", "fly", 3), ("fish", "swim", 3),
             ("deer", "idle", 1), ("person", "look", 1)],
    "forest": [("deer", "walk", 2), ("bird", "fly", 3), ("fox", "walk", 1),
               ("rabbit", "jump", 2), ("bear", "walk", 1), ("butterfly", "fly", 4)],
    "meadow": [("butterfly", "fly", 4), ("rabbit", "jump", 2), ("sheep", "idle", 3),
               ("bird", "fly", 3), ("horse", "walk", 1), ("child", "dance", 2)],
    "village": [("person", "walk", 2), ("child", "dance", 2), ("dog", "walk", 1),
                ("cat", "idle", 1), ("bird", "fly", 3), ("sheep", "idle", 3)],
    "city": [("car", "run", 2), ("person", "walk", 3), ("bird", "fly", 3),
             ("dog", "walk", 1), ("plane", "fly", 1)],
    "desert": [("camel", "walk", 2), ("eagle", "fly", 1), ("turtle", "walk", 1)],
    "mountain": [("eagle", "fly", 1), ("deer", "idle", 2), ("sheep", "idle", 3),
                 ("person", "walk", 1)],
    "snow": [("penguin", "idle", 4), ("wolf", "walk", 2), ("deer", "walk", 2),
             ("person", "walk", 1)],
    "space": [("rocket", "fly", 1), ("astronaut", "jump", 1), ("alien", "dance", 2),
              ("robot", "walk", 1)],
}
NIGHT_SWAP = {"bird": "owl", "butterfly": "bat", "eagle": "owl"}
AMBIENT_PROPS = {
    "ocean": ["tower", "tent", "chest"], "lake": ["tent", "house", "flower"],
    "forest": ["tent", "rock", "crystal"], "meadow": ["flower", "tree", "house"],
    "village": ["lamp", "flower"], "city": ["lamp"], "desert": ["cactus", "tent", "rock"],
    "mountain": ["tent", "castle", "rock"], "snow": ["tent", "house"],
    "space": ["crystal", "rock"],
}
FREE_SETTINGS = ["meadow", "forest", "village", "mountain"]
MOOD_WEATHER = {"sad": "rain", "mysterious": "fog", "tense": "storm"}

TIME_WORDS = _words({
    "night":
        "night midnight moon moonlight moonlit star starlight starry nightfall "
        "tonight nighttime nocturnal bedtime",
    "sunset":
        "evening dusk sunset twilight sundown gloaming afterglow",
    "dawn":
        "morning dawn sunrise daybreak",
    "day":
        "day noon afternoon sun sunny sunlight sunshine daylight daytime midday",
})

WEATHER_WORDS = _words({
    "rain":
        "rain rainy drizzle downpour raindrop shower monsoon drenched soaked "
        "sleet hail puddle",
    "storm":
        "storm thunder lightning tempest hurricane thunderstorm gale squall "
        "cyclone typhoon tornado stormy",
    "snow":
        "snow snowy blizzard snowflake frost snowfall flurry frosty wintry "
        "snowstorm",
    "fog":
        "fog mist haze foggy misty smog murky hazy cloudy overcast gloomy",
    "clear":
        "sunny sunshine cloudless",
})

ACTION_WORDS = _words({
    "walk":
        "walk go wander stroll travel journey march hike follow come return "
        "leave arrive enter approach explore cross roam trek move carry lead "
        "creep sneak sail drive ride set amble trudge plod stride pace patrol "
        "parade proceed advance depart wade trail accompany visit tour migrate "
        "commute deliver bring fetch push pull drag haul guide escort shuffle "
        "tiptoe limp crawl climb descend pass row voyage venture",
    "run":
        "run race rush chase flee hurry dash sprint escape charge gallop bolt "
        "scurry scamper dart zoom hasten stampede pursue trot jog scramble "
        "retreat",
    "fly":
        "fly soar glide float hover ascend swoop flutter launch flap levitate",
    "jump":
        "jump leap hop bounce cheer celebrate bound pounce vault rejoice "
        "applaud clap",
    "dance":
        "dance spin twirl sing play laugh sway waltz frolic prance skip revel "
        "party perform juggle giggle hum whistle",
    "swim":
        "swim dive paddle splash surf snorkel bathe",
    "sleep":
        "sleep rest dream nap doze snore slumber snooze hibernate relax lounge",
    "fall":
        "fall collapse tumble trip stumble faint die slip topple plunge sink "
        "crash perish swoon",
    "talk":
        "talk say speak tell ask whisper shout argue reply answer greet meet "
        "call explain discuss chat promise agree chatter mutter murmur yell "
        "announce declare proclaim preach lecture teach negotiate bargain "
        "gossip joke beg plead complain confess warn thank welcome introduce "
        "converse debate scold command",
    "fight":
        "fight kill murder destroy vanquish behead slaughter assassinate devour battle attack strike struggle wrestle duel defeat slay clash "
        "punch kick stab slash shoot bite claw ambush raid invade conquer "
        "quarrel brawl spar",
    "look":
        "look search watch see find discover stare gaze notice seek spot peer "
        "glance observe examine inspect admire spy scan behold glimpse peek "
        "marvel",
    "wave":
        "wave salute beckon",
    "work":
        "work build dig chop hammer plant harvest cook bake sew paint repair "
        "fix forge carve craft sweep stir knead plow plough sow reap",
    "idle":
        "sit wait stand stay kneel think read pray listen ponder meditate "
        "linger pause hesitate hide crouch guard eat drink write study learn "
        "mourn weep sob smile nod ",
})
VEHICLES = {"boat", "car", "rocket", "plane", "balloon", "ufo", "truck", "bus", "train", "bike",
            "tractor", "heli", "ship", "tank", "sled", "cart"}
# Death. "kill" verbs take a victim ("the pirate slew the dragon"); "die" words
# apply to their subject ("the king died").
KILL_WORDS = _words({
    "kill": "slay kill murder destroy vanquish behead slaughter assassinate devour",
    "die": "die perish dead",
})
REVIVE_WORDS = {"revive", "revived", "resurrect", "resurrected", "reborn", "alive"}
PASSIVE_MARKERS = {"was", "were", "is", "are", "been", "be", "got", "being"}
OBJECT_PRONOUNS = {"it", "him", "her", "them"}

# ---- relationships between things -----------------------------------------
# "a dog riding in a car", "the knight rode a horse", "a girl on a bicycle"
RIDE_WORDS = _words({
    "move": "ride drive sail pilot steer row paddle travel cruise commute pedal race "
            "journey board gallop cycle",
    "fly": "fly soar glide",
    "sit": "sit seat perch",
})
RIDE_ANIMAL_VERBS = {"ride", "gallop", "sit", "seat", "perch", "fly", "soar", "glide"}
# A preposition right before the vehicle is enough: "a dog in a car".
INSIDE_WORDS = {"in", "on", "inside", "into", "onto", "aboard", "atop", "upon", "astride"}
ONTOP_WORDS = {"on", "onto", "atop", "upon", "astride"}
# ...but these between the verb and the vehicle mean it is not being ridden:
# "the knight rode past the dragon".
RIDE_BLOCKERS = {"past", "to", "toward", "towards", "after", "behind", "from", "near",
                 "by", "beside", "with", "around", "over", "under", "through", "across",
                 "away", "and", "then", "while", "before", "until", "at"}

# "a girl carried a basket", "a dog with a bone": kind -> size in the hand
HOLDABLE = {"ball": 0.5, "book": 0.6, "gift": 0.4, "basket": 0.55, "lamp": 0.4,
            "balloons": 0.6, "bone": 1.0, "flower": 0.8, "crystal": 0.35,
            "pumpkin": 0.5, "mushroom": 0.4, "umbrella": 0.6, "guitar": 0.55,
            "sword": 1.0, "chest": 0.35, "telescope": 0.5, "surfboard": 0.7}
HOLD_WORDS = _words({
    "hold": "carry hold bring lift grab clutch take pick catch fetch wield raise throw "
            "play read find steal give swing wave strum wear own have",
})
HOLD_PREPS = {"with", "holding", "carrying"}

# "a boy sat on a bench", "she slept in the bed": kind -> (pose, height)
SEATABLE = {"bench": ("sit", 0.55), "sofa": ("sit", 0.6), "rock": ("sit", 1.0),
            "haystack": ("sit", 1.25), "barrel": ("sit", 0.92), "bed": ("lie", 0.68),
            "bathtub": ("sit", 0.35), "bridge": ("stand", 1.12), "table": ("stand", 0.88)}
STILL_ACTIONS = {"idle", "sleep", "talk", "look", "wave", "dance", "jump", "work", "dead"}

FLYERS = {"rocket", "plane", "balloon", "ufo", "heli"}
PHYSICAL_ACTIONS = {"walk", "run", "fly", "jump", "dance", "swim", "sleep", "fall", "fight",
                    "wave", "work", "slay", "die"}

MOOD_WORDS = _words({
    "joyful":
        "happy joy laugh smile love beautiful wonderful bright celebrate "
        "delight glad cheer warm hope fun sing dance golden victory merry proud "
        "joyful cheerful festive celebration party triumph bliss thrilled "
        "excited grateful lovely playful jolly radiant glorious hooray wedding "
        "birthday festival carnival feast",
    "sad":
        "sad cry weep tear lonely alone lost grief sorrow mourn death die dead "
        "empty farewell goodbye broken pain hurt miss gloomy miserable "
        "heartbroken despair regret tragic funeral abandoned forgotten "
        "melancholy weary",
    "tense":
        "fear afraid danger scream chase monster fight battle war attack terror "
        "panic suddenly escape threat angry rage enemy trap roar storm flee "
        "dangerous deadly furious horror nightmare doom chaos violent desperate "
        "urgent alarm ambush siege",
    "mysterious":
        "mystery mysterious strange secret magic magical ancient whisper shadow "
        "hidden unknown dream ghost enchanted curious wonder mist spell eerie "
        "haunted riddle prophecy legend myth cursed forbidden arcane mystical "
        "uncanny otherworldly",
    "calm":
        "calm quiet peace peaceful gentle soft still slow rest sleep serene "
        "breeze tranquil soothing relaxed lazy silent hush mild",
})

IRREGULAR = {
    "ridden": "ride", "driven": "drive", "held": "hold", "brought": "bring", "took": "take",
    "caught": "catch", "threw": "throw", "had": "have", "has": "have",
    "slew": "slay", "slain": "slay", "ran": "run", "flew": "fly", "flown": "fly", "swam": "swim", "swum": "swim",
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
IGNORE = {"hoped", "hoping", "hope's", "was", "his", "its", "this", "as", "us",
          "does", "goes", "going", "set", "bass", "boxing", "moved", "still", "left",
          "like", "liked", "can", "may", "might", "will", "well", "back", "even",
          "passed", "past", "kind", "present", "second", "fine", "being"}
# Words that must not be read as two drawable halves ("sea" + "sons").
NOT_COMPOUND = {"season", "seasons", "seasonal", "seasoned", "carpet", "carpets"}

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


# --------------------------------------------------------------------------
# Extended cast, props and place dressing
# --------------------------------------------------------------------------
MODELS.update({
    "angel": {"base": "person", "robe": True, "color": "#fbfbf5", "default": "fly"},
    "vampire": {"base": "person", "robe": True, "color": "#1b1420", "skin": "#e6e1ea"},
    "zombie": {"base": "person", "color": "#5b6b4a", "skin": "#9bbf8a"},
    "skeleton": {"base": "person", "color": "#e8e6df", "skin": "#f4f2ea"},
    "santa": {"base": "person", "hat": True, "robe": True, "color": "#c62828"},
    "elf": {"base": "person", "hat": True, "scale": 0.6, "color": "#2e8b57"},
    "dwarf": {"base": "person", "scale": 0.62, "color": "#7a4a2a"},
    "clown": {"base": "person", "bigHead": True, "color": "#ff5fa2", "default": "dance"},
    "mermaid": {"base": "person", "robe": True, "color": "#2aa198", "default": "swim",
                "water": True, "implies": "ocean"},
    "chef": {"base": "person", "hat": True, "color": "#f5f5f5", "default": "work"},
    "police": {"base": "person", "color": "#1f3a6e"},
    "priest": {"base": "person", "robe": True, "color": "#5a4632"},
    "devil": {"base": "person", "color": "#b71c1c", "skin": "#e0483a"},
    "superhero": {"base": "person", "color": "#d32f2f", "default": "fly"},
    "scarecrow": {"base": "person", "hat": True, "color": "#b58a3c", "skin": "#e3c887"},
    "donkey": {"base": "quad", "color": "#8d8d8d", "len": 1.3, "leg": 0.7, "width": 0.45,
               "neck": 0.35, "ears": "long", "tail": 0.5},
    "zebra": {"base": "quad", "pattern": "stripes", "color": "#e9e9ee", "len": 1.6, "leg": 0.9, "width": 0.5,
              "neck": 0.5, "ears": "up", "tail": 0.6},
    "pegasus": {"base": "quad", "color": "#f7f7fb", "len": 1.7, "leg": 0.95, "width": 0.55,
                "neck": 0.55, "ears": "up", "tail": 0.7, "wings": True, "default": "fly"},
    "griffin": {"base": "quad", "color": "#c79a3e", "len": 1.5, "leg": 0.6, "width": 0.55,
                "ears": "up", "tail": 0.8, "wings": True, "default": "fly"},
    "panda": {"base": "quad", "color": "#f4f4f4", "len": 1.3, "leg": 0.45, "width": 0.75,
              "ears": "round", "tail": 0.1},
    "kangaroo": {"base": "quad", "color": "#b98452", "len": 0.8, "leg": 0.7, "width": 0.35,
                 "neck": 0.3, "ears": "long", "tail": 0.9, "default": "jump"},
    "goat": {"base": "quad", "color": "#d9d2c3", "len": 0.9, "leg": 0.45, "width": 0.4,
             "ears": "round", "tail": 0.12, "horn": True},
    "llama": {"base": "quad", "color": "#f0e6d2", "len": 1.2, "leg": 0.8, "width": 0.5,
              "neck": 0.8, "ears": "up", "tail": 0.15},
    "rhino": {"base": "quad", "color": "#7f858c", "len": 2.0, "leg": 0.7, "width": 1.0,
              "ears": "round", "tail": 0.3, "horn": True},
    "giraffe": {"base": "quad", "pattern": "spots", "ink": "#8a5a24", "color": "#e0b24a", "len": 1.5, "leg": 1.6, "width": 0.55,
                "neck": 1.7, "ears": "round", "tail": 0.6},
    "squirrel": {"base": "quad", "color": "#b5651d", "len": 0.35, "leg": 0.12, "width": 0.2,
                 "ears": "up", "tail": 0.5},
    "frog": {"base": "quad", "color": "#4caf50", "len": 0.3, "leg": 0.1, "width": 0.28,
             "tail": 0.05, "default": "jump"},
    "crocodile": {"base": "quad", "color": "#4d7a3a", "len": 2.4, "leg": 0.16, "width": 0.5,
                  "tail": 1.5, "speed": 0.6},
    "crab": {"base": "quad", "color": "#d84a2f", "len": 0.3, "leg": 0.1, "width": 0.4,
             "tail": 0.05, "speed": 0.5},
    "seagull": {"base": "bird", "color": "#f2f2f2", "scale": 1.2, "default": "fly"},
    "duck": {"base": "bird", "color": "#c9a24a"},
    "swan": {"base": "bird", "color": "#fafafa", "scale": 1.6},
    "chicken": {"base": "bird", "color": "#f1e9d8", "scale": 1.1},
    "parrot": {"base": "bird", "color": "#2eaf4f", "scale": 1.1, "default": "fly"},
    "flamingo": {"base": "bird", "color": "#ff8fb1", "scale": 1.7},
    "peacock": {"base": "bird", "color": "#1c8f9e", "scale": 1.6},
    "phoenix": {"base": "bird", "color": "#ff6a1a", "scale": 2.4, "default": "fly"},
    "bee": {"base": "bird", "color": "#f4c20d", "scale": 0.3, "default": "fly"},
    "octopus": {"base": "fish", "color": "#9c4fb5", "scale": 1.6, "default": "swim",
                "water": True, "implies": "ocean"},
    "submarine": {"base": "fish", "color": "#f2c230", "scale": 4.0, "default": "swim",
                  "water": True, "implies": "ocean"},
    "ufo": {"base": "ufo", "default": "fly"},
    "balloon": {"base": "balloon", "default": "fly"},
})

PROPS.update({
    "bridge": {"base": "bridge", "r": 7},
    "fence": {"base": "fence", "r": 5},
    "well": {"base": "well", "r": 5},
    "statue": {"base": "statue", "r": 6},
    "windmill": {"base": "windmill", "r": 13},
    "bench": {"base": "bench", "r": 3.2},
    "fountain": {"base": "fountain", "r": 6},
    "grave": {"base": "grave", "r": 4.5},
    "snowman": {"base": "snowman", "r": 3.5},
    "table": {"base": "table", "r": 3},
    "flag": {"base": "flag", "r": 5.5},
    "barrel": {"base": "barrel", "r": 3.5},
    "mushroom": {"base": "mushroom", "r": 3.5},
    "stall": {"base": "stall", "r": 6},
    "pyramid": {"base": "pyramid", "r": 30, "implies": "desert"},
    "igloo": {"base": "igloo", "r": 7, "implies": "snow"},
    "bush": {"base": "bush", "r": 4.5},
    "signpost": {"base": "signpost", "r": 4},
    "pumpkin": {"base": "pumpkin", "r": 2.8},
})

# Words that bring set dressing with them, whatever the place.
PLACE_DRESSING = {
    "farm": ["fence", "windmill"], "ranch": ["fence"], "farmyard": ["fence"],
    "cemetery": ["grave"], "graveyard": ["grave"], "funeral": ["grave"],
    "market": ["stall"], "bazaar": ["stall"], "marketplace": ["stall", "barrel"],
    "playground": ["bench"], "park": ["bench", "fountain"], "plaza": ["fountain"],
    "harbor": ["barrel"], "harbour": ["barrel"], "port": ["barrel"], "dock": ["barrel"],
    "wharf": ["barrel"], "marina": ["flag"], "garden": ["flower", "fence"],
    "orchard": ["tree"], "vineyard": ["fence"], "festival": ["flag", "stall"],
    "fair": ["flag", "stall"], "carnival": ["flag", "stall"], "wedding": ["flag", "table"],
    "party": ["flag", "table"], "celebration": ["flag"], "birthday": ["table", "flag"],
    "parade": ["flag"], "halloween": ["pumpkin", "grave"], "christmas": ["snowman", "tree"],
    "crossroads": ["signpost"], "oasis": ["tree", "well"], "ruins": ["statue", "rock"],
}
AMBIENT_PROPS.update({
    "ocean": ["tower", "tent", "chest", "barrel", "flag"],
    "lake": ["tent", "house", "flower", "bridge", "bench"],
    "forest": ["tent", "rock", "crystal", "mushroom", "bush", "signpost"],
    "meadow": ["flower", "tree", "house", "windmill", "fence", "bench"],
    "village": ["lamp", "flower", "well", "stall", "fountain", "fence"],
    "city": ["lamp", "bench", "fountain", "statue"],
    "desert": ["cactus", "tent", "rock", "pyramid", "well"],
    "mountain": ["tent", "castle", "rock", "signpost", "flag"],
    "snow": ["tent", "house", "snowman", "igloo"],
    "space": ["crystal", "rock", "flag"],
})
AMBIENT["ocean"] += [("seagull", "fly", 4), ("crab", "walk", 2)]
AMBIENT["lake"] += [("duck", "idle", 3), ("swan", "idle", 2), ("frog", "jump", 2)]
AMBIENT["forest"] += [("squirrel", "run", 2), ("owl", "fly", 1)]
AMBIENT["village"] += [("chicken", "idle", 3), ("goat", "idle", 2), ("duck", "walk", 2)]
AMBIENT["meadow"] += [("bee", "fly", 4), ("cow", "idle", 2), ("goat", "idle", 2)]
AMBIENT["desert"] += [("crocodile", "walk", 1)]
AMBIENT["mountain"] += [("goat", "idle", 3), ("balloon", "fly", 1)]
AMBIENT["space"] += [("ufo", "fly", 1)]
AMBIENT["city"] += [("balloon", "fly", 1)]


# --------------------------------------------------------------------------
# Vehicles and everyday objects
# --------------------------------------------------------------------------
MODELS.update({
    "taxi": {"base": "car", "variant": "taxi", "color": "#f2c230", "speed": 3.0,
             "implies": "city", "default": "walk"},
    "policecar": {"base": "car", "variant": "police", "color": "#f4f4f4", "speed": 3.6,
                  "implies": "city", "default": "walk"},
    "ambulance": {"base": "car", "variant": "ambulance", "color": "#f4f4f4", "speed": 3.6,
                  "implies": "city", "default": "walk"},
    "van": {"base": "car", "variant": "van", "speed": 2.8, "default": "walk"},
    "pickup": {"base": "car", "variant": "pickup", "speed": 2.8, "default": "walk"},
    "racecar": {"base": "car", "color": "#e02020", "speed": 5.0, "default": "run"},
    "truck": {"base": "truck", "speed": 2.6, "default": "walk"},
    "firetruck": {"base": "truck", "variant": "fire", "color": "#d62828", "speed": 3.2,
                  "implies": "city", "default": "walk"},
    "bus": {"base": "bus", "speed": 2.4, "implies": "city", "default": "walk"},
    "schoolbus": {"base": "bus", "color": "#f2b632", "speed": 2.2, "default": "walk"},
    "train": {"base": "train", "speed": 3.0, "default": "walk"},
    "bicycle": {"base": "bike", "speed": 2.0, "default": "walk"},
    "motorcycle": {"base": "bike", "variant": "motor", "speed": 3.4, "default": "walk"},
    "tractor": {"base": "tractor", "speed": 1.2, "implies": "village", "default": "walk"},
    "helicopter": {"base": "heli", "default": "fly"},
    "ship": {"base": "ship", "speed": 1.1, "default": "walk", "water": True, "implies": "ocean"},
    "rowboat": {"base": "boat", "sail": False, "speed": 0.8, "default": "walk", "water": True,
                "implies": "lake"},
    "speedboat": {"base": "boat", "variant": "speed", "speed": 3.5, "default": "walk",
                  "water": True, "implies": "ocean"},
    "tank": {"base": "tank", "speed": 1.0, "default": "walk"},
    "sled": {"base": "sled", "speed": 2.4, "implies": "snow", "default": "walk"},
    "cart": {"base": "cart", "speed": 1.0, "default": "walk"},
})

ACTOR_WORDS.update(_words({
    "car": "car automobile sedan motorcar limousine limo convertible hatchback coupe suv "
           "jeep vehicle",
    "taxi": "taxi cab taxicab",
    "policecar": "cruiser squadcar",
    "ambulance": "ambulance",
    "van": "van minivan campervan camper caravan",
    "pickup": "pickup",
    "racecar": "racecar racer sportscar ferrari lamborghini porsche",
    "truck": "truck lorry trailer tanker semi",
    "firetruck": "firetruck",
    "bus": "bus coach minibus trolley",
    "schoolbus": "schoolbus",
    "train": "train tram locomotive railway railroad metro express monorail",
    "bicycle": "bicycle bike cyclist tricycle",
    "motorcycle": "motorcycle motorbike scooter moped biker",
    "tractor": "tractor bulldozer excavator digger harvester forklift",
    "helicopter": "helicopter chopper copter drone",
    "ship": "ship liner steamer freighter cruise battleship warship tugboat barge "
            "frigate destroyer steamship",
    "boat": "boat sailboat vessel yacht ferry galleon schooner catamaran sloop",
    "rowboat": "rowboat canoe kayak raft dinghy lifeboat gondola",
    "speedboat": "speedboat motorboat jetski",
    "tank": "tank",
    "sled": "sled sleigh sledge toboggan",
    "cart": "cart wagon carriage chariot stagecoach rickshaw",
}))

PROPS.update({
    "ball": {"base": "beachball", "r": 2.6},
    "kite": {"base": "kite", "r": 5},
    "umbrella": {"base": "umbrella", "r": 4},
    "book": {"base": "books", "r": 2.4},
    "bed": {"base": "bed", "r": 3.6},
    "sofa": {"base": "sofa", "r": 3.4},
    "tv": {"base": "tv", "r": 3.2},
    "clock": {"base": "clock", "r": 3.4},
    "door": {"base": "door", "r": 4},
    "ladder": {"base": "ladder", "r": 3.6},
    "mailbox": {"base": "mailbox", "r": 3.4},
    "trashcan": {"base": "trashcan", "r": 3.2},
    "trafficlight": {"base": "trafficlight", "r": 4.6},
    "stopsign": {"base": "stopsign", "r": 4.4},
    "hydrant": {"base": "hydrant", "r": 3},
    "swing": {"base": "swing", "r": 6},
    "slide": {"base": "slide", "r": 6},
    "sandcastle": {"base": "sandcastle", "r": 3.2},
    "surfboard": {"base": "surfboard", "r": 3.6},
    "cannon": {"base": "cannon", "r": 3.6},
    "ferriswheel": {"base": "ferriswheel", "r": 22},
    "carousel": {"base": "carousel", "r": 10},
    "telescope": {"base": "telescope", "r": 3},
    "cake": {"base": "cake", "r": 2.6},
    "gift": {"base": "gift", "r": 2.6},
    "xmastree": {"base": "xmastree", "r": 5},
    "basket": {"base": "basket", "r": 2.4},
    "haystack": {"base": "haystack", "r": 5},
    "beehive": {"base": "beehive", "r": 3.6},
    "piano": {"base": "piano", "r": 3.4},
    "drums": {"base": "drums", "r": 3.4},
    "guitar": {"base": "guitar", "r": 2.8},
    "easel": {"base": "easel", "r": 3},
    "globe": {"base": "globe", "r": 2.8},
    "trophy": {"base": "trophy", "r": 2.6},
    "rainbow": {"base": "rainbow", "r": 70},
    "sword": {"base": "swordstone", "r": 3},
    "dish": {"base": "dish", "r": 6},
    "wheelbarrow": {"base": "wheelbarrow", "r": 3.2},
    "bathtub": {"base": "bathtub", "r": 3.2},
    "fridge": {"base": "fridge", "r": 3.4},
    "computer": {"base": "computer", "r": 3},
    "phonebooth": {"base": "phonebooth", "r": 4.4},
    "busstop": {"base": "busstop", "r": 5},
    "balloons": {"base": "balloons", "r": 3},
    "bone": {"base": "bone", "r": 2},
    "shield": {"base": "shield", "r": 3},
})

PROP_WORDS.update(_words({
    "ball": "ball football soccer basketball baseball volleyball beachball toy",
    "kite": "kite",
    "umbrella": "umbrella parasol sunshade towel",
    "book": "book novel textbook diary journal notebook newspaper magazine scroll "
            "manuscript encyclopedia homework",
    "bed": "bed mattress crib cot bunk hammock bedroom",
    "sofa": "sofa couch armchair loveseat",
    "tv": "tv television telly",
    "clock": "clock",
    "door": "door doorway entrance exit",
    "ladder": "ladder scaffold",
    "mailbox": "mailbox postbox letterbox",
    "trashcan": "trash garbage bin dumpster rubbish litter",
    "trafficlight": "stoplight crosswalk",
    "stopsign": "stopsign roadsign",
    "hydrant": "hydrant",
    "swing": "swings seesaw swingset",
    "slide": "slide",
    "sandcastle": "sandcastle",
    "surfboard": "surfboard skateboard snowboard",
    "cannon": "cannon catapult artillery",
    "ferriswheel": "ferris rollercoaster",
    "carousel": "carousel",
    "telescope": "telescope binoculars microscope camera tripod",
    "cake": "cake pie cupcake dessert pastry cookie donut doughnut pudding",
    "gift": "gift parcel package",
    "xmastree": "ornament tinsel",
    "basket": "basket fruit apple banana pear grape vegetable groceries bread "
              "food harvest berries cherry lemon peach",
    "haystack": "haystack hay bale straw",
    "beehive": "beehive hive honey honeycomb",
    "piano": "piano organ keyboard",
    "drums": "drum drums cymbal percussion band concert orchestra",
    "guitar": "guitar violin cello banjo ukulele lute harp instrument amplifier",
    "easel": "easel painting canvas portrait artwork masterpiece mural",
    "globe": "globe atlas",
    "trophy": "trophy medal prize award",
    "rainbow": "rainbow",
    "sword": "sword excalibur dagger blade spear axe",
    "dish": "antenna radar satellite transmitter",
    "wheelbarrow": "wheelbarrow shovel spade rake hoe",
    "bathtub": "bathtub bath tub jacuzzi",
    "fridge": "fridge refrigerator freezer kitchen oven stove",
    "computer": "computer laptop monitor pc desktop tablet screen office",
    "phonebooth": "payphone telephone",
    "busstop": "busstop",
    "balloons": "balloon balloons confetti streamers decorations",
    "bone": "bone bones fossil",
    "shield": "shield armor armour armory armoury",
    "table": "table desk feast banquet altar dinner supper lunch breakfast meal buffet",
    "bench": "bench chair stool",
    "lamp": "lamp lantern lamppost streetlight candle torch streetlamp lightbulb chandelier",
    "tree": "tree oak pine willow birch maple cedar palm spruce elm redwood sapling stump",
    "chest": "treasure chest gold box coffer loot coins riches suitcase luggage money cash",
    "flag": "flag banner pennant bunting flagpole",
    "barrel": "barrel crate keg cask cargo",
}))

PLACE_DRESSING.update({
    "beach": ["umbrella", "sandcastle"], "seaside": ["umbrella"],
    "playground": ["swing", "slide"], "park": ["bench", "fountain"],
    "carnival": ["ferriswheel", "carousel"], "fair": ["ferriswheel", "stall"],
    "funfair": ["ferriswheel", "carousel"], "fairground": ["ferriswheel", "carousel"],
    "circus": ["tent", "flag", "balloons"], "festival": ["flag", "stall", "balloons"],
    "birthday": ["cake", "balloons", "gift"], "party": ["balloons", "table", "flag"],
    "wedding": ["flag", "table", "cake"], "christmas": ["xmastree", "gift", "snowman"],
    "picnic": ["basket", "table"], "concert": ["drums", "guitar"], "band": ["drums", "guitar"],
    "kitchen": ["fridge", "table"], "bedroom": ["bed", "clock"], "office": ["computer"],
    "classroom": ["book", "globe"], "school": ["book"], "library": ["book"],
    "museum": ["statue", "easel"], "gallery": ["easel"], "studio": ["easel"],
    "farm": ["fence", "haystack", "windmill"], "barn": ["haystack"],
    "street": ["trafficlight"], "road": ["stopsign"], "highway": ["stopsign"],
    "station": ["busstop", "clock"], "observatory": ["telescope", "dish"],
    "battlefield": ["cannon", "flag"], "fort": ["cannon", "flag"], "armory": ["shield"],
    "livingroom": ["sofa", "tv"], "garage": ["ladder"],
    "construction": ["ladder", "wheelbarrow"], "championship": ["trophy"],
    "tournament": ["trophy", "flag"], "olympics": ["trophy", "flag"],
})
for _place, _extra in {
    "ocean": ["umbrella", "sandcastle", "surfboard", "ball"],
    "city": ["trafficlight", "mailbox", "hydrant", "trashcan", "busstop", "phonebooth"],
    "village": ["haystack", "mailbox", "wheelbarrow", "basket"],
    "meadow": ["kite", "haystack", "beehive", "swing", "basket"],
    "lake": ["basket", "kite"], "forest": ["beehive", "ladder"],
    "mountain": ["telescope"], "space": ["dish", "telescope"], "snow": ["xmastree"],
    "desert": ["bone"],
}.items():
    AMBIENT_PROPS[_place] += _extra
AMBIENT["city"] += [("bus", "walk", 1), ("taxi", "walk", 1), ("truck", "walk", 1),
                    ("bicycle", "walk", 1), ("helicopter", "fly", 1)]
AMBIENT["ocean"] += [("ship", "walk", 1), ("speedboat", "walk", 1)]
AMBIENT["lake"] += [("rowboat", "walk", 1)]
AMBIENT["village"] += [("tractor", "walk", 1), ("cart", "walk", 1), ("bicycle", "walk", 1)]
AMBIENT["meadow"] += [("tractor", "walk", 1), ("bicycle", "walk", 1)]
AMBIENT["snow"] += [("sled", "walk", 1)]
AMBIENT["mountain"] += [("helicopter", "fly", 1)]
