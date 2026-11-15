# Typing Racer

Typing Racer is a browser-based typing game. Race friends or practice against bots, customize your car, and choose from four tracks, including Moon.

## Gameplay Demo

[Watch the gameplay video](Gameplay.mp4)

## Requirements

- Python 3.9 or newer
- A modern web browser
- No third-party Python packages required

## Run the game

Clone the repository and enter its folder:

```sh
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
```

On Windows, double-click `start.bat`. Or start the server from a terminal:

```sh
python server.py
```

On macOS or Linux, use:

```sh
python3 server.py
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser. The server opens it automatically unless started with `--no-browser`.

## Play with friends

Create a race and share the invite link or room code shown in the game. Friends can join from the same Wi-Fi or office network using the address printed by the server. If Windows Firewall prompts you, allow Python on your private network.

This game is intended for private networks. Do not expose the server to the public internet or forward its port.

You can also choose **Practice with bots** to race on your own. Select a text pack, car, and track in the lobby. Type the displayed text to move; your WPM and accuracy are shown during the race. After finishing, right-click the track to make your car do a backflip.

## Run tests

```sh
python -m unittest discover -s tests
```

## Project layout

- `public/` - browser game, styles, and client-side JavaScript
- `typingracer/` - Python server and game logic
- `tests/` - automated tests

## License

No license is included yet. Add a license if you want to grant others permission to reuse or redistribute this project.
