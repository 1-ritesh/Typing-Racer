"""Race texts. Everything is plain printable ASCII so any keyboard can type it."""

from __future__ import annotations

import random
import re

from . import config

PACKS: dict[str, dict] = {
    "sprint": {
        "label": "Sprint",
        "blurb": "Short and snappy",
        "texts": [
            "The engine roars, the lights go green, and every finger on the keyboard turns into a gas pedal.",
            "Fast hands win races, but steady hands never crash. Keep your rhythm and let the words flow.",
            "A quiet garage, a glowing screen, and a keyboard that is ready to race around the next corner.",
            "Take a deep breath, relax your shoulders, and let your fingers find the road ahead.",
            "Rain on the window, music in the headphones, and ten fingers dancing across the keys.",
            "Every great driver started with a single lap, and every great typist with a single word.",
            "Sharp turns, smooth shifts, and a finish line that gets closer with every letter you type.",
            "Slow is smooth and smooth is fast, so stay calm and keep your eyes on the next word.",
            "The coffee is hot, the keys are clicking, and the race is about to begin.",
            "Skip the shortcuts, hit the right keys, and watch your car leave the others in the dust.",
        ],
    },
    "standard": {
        "label": "Grand Prix",
        "blurb": "A balanced paragraph",
        "texts": [
            "Every morning the city wakes up slowly, one window at a time. Bakers shape warm bread, buses hum along their routes, and somewhere a student is typing the last paragraph of an essay before the sun is fully up.",
            "A good racing team is more than a fast car. It is a group of people who trust each other, practice their jobs again and again, and stay calm when the pressure rises. Tiny details decide who reaches the flag first.",
            "The old lighthouse stands at the edge of the cliff, watching the sea. When storms roll in from the north, its beam sweeps across the waves like a patient hand, guiding small boats safely back toward the harbor.",
            "Learning to type quickly feels strange at first, because your fingers seem to know things your mind does not. After enough practice, the letters simply appear on the screen, and thinking about them becomes unnecessary.",
            "On the first warm day of spring, the park fills with kites, dogs, and laughing kids. Someone plays a guitar near the fountain, and a vendor sells lemonade so cold that it makes your teeth tingle.",
            "Space travel sounds like a dream, yet it is built on careful checklists, endless tests, and plain hard work. Every launch begins with thousands of small decisions made by people who never stop double checking.",
            "A map is only a drawing until you walk the path it shows. Then the hills grow steep, the river sounds louder than expected, and every turn becomes a small story that you will tell your friends later.",
            "The kitchen smelled of cinnamon and fresh apples. Grandma stirred the pot with a wooden spoon, humming an old tune, while the rain tapped gently on the window and the whole house felt warm and safe.",
            "When the final lap begins, the crowd rises to its feet. Engines scream, tires grip the asphalt, and two cars race side by side toward the last corner, each driver hoping the other will blink first.",
            "Robots in the factory never get tired, but they also never get curious. People still invent the new ideas, ask the strange questions, and notice the little problems that a machine would happily walk right past.",
        ],
    },
    "marathon": {
        "label": "Marathon",
        "blurb": "Long haul, big bragging rights",
        "texts": [
            "The train left the station just after sunrise, carrying sleepy passengers toward the mountains. Outside the window, fields of yellow flowers flashed past, and thin mist hung above the river like a silver scarf. A child pressed her nose to the glass, counting every bridge and every tunnel, while her father poured tea from a battered flask. Nobody spoke much, but the steady rhythm of the wheels felt like a song that everyone knew and nobody needed to sing.",
            "Long before anyone built a racetrack, people raced for the simple joy of it. They ran across meadows, rowed across lakes, and rode horses along dusty roads to see who would arrive first. Over time the vehicles changed, the rules grew longer, and the prizes became shinier, yet the heart of the contest stayed exactly the same. Two competitors, one finish line, and a moment where everything else disappears except the next step ahead.",
            "In a small workshop at the end of a crooked street, an old clockmaker repaired watches for the whole town. He worked slowly, with tiny screwdrivers and a magnifying glass, and he never raised his voice. Visitors often stayed longer than they planned, simply to watch the careful movement of his hands. When someone asked how he stayed so patient, he smiled and said that a clock cannot be hurried, but it can be understood.",
            "Practice is a strange kind of magic. On the first day your hands feel clumsy, your mistakes pile up, and the goal seems far away. On the tenth day you notice a little more rhythm. On the hundredth day something quietly clicks, and you realize that you are no longer thinking about every single movement. The skill has become part of you, like walking or whistling. That is why champions are made in thousands of ordinary moments.",
            "The desert at night is not silent at all. Insects chirp in the dry grass, a distant owl asks its question again and again, and the wind draws soft shapes in the sand. Above the camp, the stars are so thick that they look like spilled sugar on dark velvet. A traveler leans against a warm rock, listening to the quiet music of the world, and decides that the long road behind him was worth every single dusty mile.",
            "Every city has a secret rhythm. In the early hours, delivery trucks rumble through empty streets and bakeries glow like small lanterns. By noon the sidewalks are crowded, phones are ringing, and bicycles weave between taxis with impossible confidence. At dusk the lights come on one by one, and the whole skyline seems to take a deep breath. If you stand still on a bridge and listen carefully, you can almost hear the city thinking about tomorrow.",
        ],
    },
    "tricky": {
        "label": "Tricky Turns",
        "blurb": "Numbers, capitals and punctuation",
        "texts": [
            "On March 14th, 2027, Dr. Lopez drove 1,250 miles in 18 hours; she averaged 69.4 mph, stopped 3 times, and said, \"It's not the speed - it's the stamina!\"",
            "Order #4821 includes: 2 laptops ($1,899.99 each), 5 cables ($12.50 each), and 1 keyboard ($79). Total = $3,941.48 (tax not included).",
            "Wait... is that a 'real' record? Yes! The 100-meter dash ended in 9.58 seconds; the crowd (about 50,000 fans) roared, clapped & cheered for 5 whole minutes.",
            "if (speed > 200) { boost = false; } else { boost = true; } // keep it simple, keep it fast!",
            "Q: What has 4 wheels and flies? A: A garbage truck! Remember: Rule #1 - always type carefully; Rule #2 - never skip Rule #1.",
            "The recipe needs 3/4 cup of sugar, 2 eggs, 1 tsp. of vanilla, and 250 g of flour. Bake at 180 C for 25-30 minutes, then let it cool.",
            "Dear team, the meeting moved to Room B-204 at 3:45 PM (not 4:15!). Please bring your laptops, notes & ideas. Thanks - Priya.",
            "Pack list: tent, 2 sleeping bags, flashlight (batteries!), 5 bottles of water, snacks, a map; and don't forget your sense of humor.",
            "User_42 scored 9,870 points in level 7-3, beating the old record by 1,205. 'Unbelievable,' wrote Max: 'I blinked and it was over!'",
        ],
    },
}

CUSTOM_ID = "custom"
CUSTOM_LABEL = "Your own text"

_REPLACEMENTS = {
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"',
    "\u2013": "-", "\u2014": "-", "\u2212": "-",
    "\u2026": "...", "\u00a0": " ", "\u2009": " ", "\u200b": "",
}


def pack_ids() -> tuple[str, ...]:
    return tuple(PACKS) + (CUSTOM_ID,)


def pack_info() -> list[dict]:
    info = []
    for pack_id, pack in PACKS.items():
        sizes = [len(t) for t in pack["texts"]]
        info.append({"id": pack_id, "label": pack["label"], "blurb": pack["blurb"], "min": min(sizes), "max": max(sizes)})
    info.append({
        "id": CUSTOM_ID, "label": CUSTOM_LABEL, "blurb": "Paste anything your friends should type",
        "min": config.CUSTOM_TEXT_MIN, "max": config.CUSTOM_TEXT_MAX,
    })
    return info


def pick(pack_id: str, avoid: str = "") -> str:
    pool = PACKS[pack_id]["texts"]
    options = [t for t in pool if t != avoid] or pool
    return random.choice(options)


def sanitize_custom(raw: object) -> str | None:
    """Normalise pasted text to typeable ASCII; None if it is too short to race on."""
    if not isinstance(raw, str):
        return None
    for old, new in _REPLACEMENTS.items():
        raw = raw.replace(old, new)
    kept = [" " if ch in "\r\n\t" else ch for ch in raw if ch in "\r\n\t" or " " <= ch <= "~"]
    text = re.sub(r" {2,}", " ", "".join(kept)).strip()
    if len(text) < config.CUSTOM_TEXT_MIN:
        return None
    return text[: config.CUSTOM_TEXT_MAX].rstrip()
