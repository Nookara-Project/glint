# Glint

A game clipper for Windows, made for Nookara. Save the last moments of a game with a hotkey, trim it,
and share it at https://clips.nookara.cc.

| Folder | What |
|---|---|
| `desktop/` | the Electron app for Windows (capture, editor, uploads) |
| `server/` | the clips backend (Node, SQLite) that serves clips.nookara.cc |
| `web/` | the web viewer and editor |
| `design/` | logos |

`CONTRACT.md` describes how the three parts talk to each other and to Nookara.

## Desktop

```bash
cd desktop
npm ci
npm start        # builds the helper, fetches ffmpeg, runs the app
npm test
```

Game detection uses the same list as Ember desktop (`lib/vendor/games.js`); `scripts/sync-games.js`
refreshes it from an Ember checkout (`EMBER_DIR`).

## Server

```bash
cd server
npm ci
npm test
```

Clips are stored as Nookara video uploads; the backend talks to Nookara only through its public API, as the registered app Glint.

## License

AGPL-3.0, see [LICENSE](LICENSE).
