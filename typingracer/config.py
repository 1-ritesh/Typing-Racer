"""Tunable game constants. Modules read these as `config.NAME` so tests can override them."""

APP_NAME = "Typing Racer"
DEFAULT_PORT = 8080
PORT_FALLBACK_TRIES = 20

MAX_PLAYERS = 8
MAX_ROOMS = 60
NAME_MAX = 16
CUSTOM_TEXT_MIN = 20
CUSTOM_TEXT_MAX = 700

COUNTDOWN_S = 4.0          # "get ready" beat + 3-2-1
TICK_HZ = 10
FINISH_GRACE_S = 20.0      # after the first human finishes, everyone else gets this long
BOT_TAIL_S = 4.0           # once every human is done, bots may keep racing this long
MAX_RACE_S = 300.0
RESULTS_IDLE_S = 600.0     # results screen falls back to the lobby after this long
GRACE_LOBBY_S = 12.0       # how long a dropped player keeps their seat
GRACE_RACE_S = 45.0
IDLE_PING_S = 15.0
IDLE_TIMEOUT_S = 50.0

MAX_CPS = 30.0             # progress above this many chars/second is clamped (about 360 WPM)
NITRO_STREAK = 15          # consecutive correct characters that light up the nitro flame
POINTS = (10, 8, 6, 5, 4, 3, 2, 1)

MSG_RATE_CAPACITY = 60
MSG_RATE_PER_S = 40

CAR_STYLES = ("coupe", "formula", "hatch", "pickup")
CAR_COLORS = (
    ("Redline", "#ff3b4e"),
    ("Tangerine", "#ff8a1f"),
    ("Solar", "#ffd23f"),
    ("Lime", "#8be04e"),
    ("Mint", "#1fe0b0"),
    ("Cyan", "#28d7ff"),
    ("Cobalt", "#4d7cff"),
    ("Violet", "#a259ff"),
    ("Bubblegum", "#ff5fd2"),
    ("Ghost", "#f1f3ff"),
)
THEMES = (
    ("neon", "Neon Night"),
    ("sunny", "Sunny Coast"),
    ("desert", "Desert Dusk"),
    ("moon", "Moon"),
)
BOT_LEVELS = (
    ("rookie", "Rookie", 24),
    ("casual", "Casual", 40),
    ("pro", "Pro", 65),
    ("champ", "Champ", 95),
)
BOT_NAMES = (
    "Turbo Tim", "Nitro Nia", "Drift Dan", "Lightning Lu",
    "Rocket Rin", "Chrome Charlie", "Gearhead Gus", "Piston Pat",
    "Sprocket Sam", "Axle Ana", "Torque Tess", "Burnout Ben",
)
REACTIONS = ("fire", "laugh", "wow", "clap", "flag", "wind")
