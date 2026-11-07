# Glint — shared contract (desktop app ↔ backend ↔ web)

Glint = Medal-style game clipper, an official Nookara app. Backend + web live at
`https://clips.nookara.cc/` (old `ikelene.net/glint/` pages redirect there; its `/glint/api/` and `/glint/download/` keep answering for installed apps). Repo layout: `server/` (Node API), `web/` (static viewer), `desktop/` (Electron, Windows).

## Accounts
- Signs in as the registered Nookara app **Glint** since 1.1.12 (`app_7c41e9b02fd86a35c1e7`: View Profile + Upload Media, Nookara's [Apps docs](https://nookara.cc/docs/nookara-apps)); everything says `Origin: https://clips.nookara.cc`. Before that: ext-code sign-in, project name **"Glint"**, permissions **4113** (PROFILE_READ 1 | STORAGE_READ 16 | MEDIA_UPLOAD 4096) since desktop 1.1.3 - STORAGE_READ lets the app show `GET /storage/info/usage` (account space). Older tokens (4097) keep working; the app falls back to `/account/me` storage_used/storage_limit and never forces a re-login.
  Desktop: open `https://nookara.cc/login?code=<code>` (the Glint app, id in `desktop/lib/velora.js`; sign-in contract in Nookara's [Apps docs](https://nookara.cc/docs/nookara-apps)) in the system browser with `redirect_uri` on a throwaway `http://127.0.0.1:<port>/` page, which sends the grant back; `POST /auth/ext-code/exchange` swaps it for the token.
  Web: same flow in a popup (the grant arrives by postMessage), token in localStorage `glint_token`.
- Every Glint API call that needs a user sends `Authorization: Bearer <velora token>`. The backend validates against Nookara
  (`/auth/validate` or `/account/me`, cached ~5 min) and never stores the token.

## Clip storage
- Uploaded clips are Nookara **media videos** (`POST /media/video/chunk` multipart {sessionId, chunkIndex, totalChunks, chunk}
  10 MB chunks, then `POST /media/video/finalize` {sessionId, mimeType:'video/mp4', originalName}) → `{url}`.
  Video uploading is becoming free for everyone (Nat 2026-10-28): don't gate or advertise uploading as Pro. Still handle a
  403 `pro_only` gracefully (generic "uploading isn't available on your account yet") until Nookara flips it; 413
  `storage_limit_exceeded` = out of account storage.
- The desktop uploads the TRIMMED mp4 (H.264/AAC, `+faststart`) straight to Nookara, then registers it with Glint.
- Source of truth = the Nookara upload. If the file is gone (deleted from the account's uploads/storage), the clip is dropped
  from every listing and `/c/<id>` shows a 404. The backend HEADs the media URL on view (cached ~2 min) and in a
  sweep every ~15 min, and also checks `GET /media/list` with the caller's token whenever the owner lists their clips.

## API — base `https://clips.nookara.cc/api`
| method | path | auth | body / notes |
|---|---|---|---|
| POST | `/clips` | yes | `{videoUrl, title, game, gameIcon?, durationSec, width, height, visibility:'public'|'unlisted', thumbnail}` (thumbnail = JPEG data URL ≤ 300 KB). Backend confirms `videoUrl` is in the caller's `GET /media/list`, stores the media id. → `{id, url:'https://ikelene.net/glint/c/<id>'}` |
| PATCH | `/clips/:id` | owner | `{title?, visibility?}` |
| DELETE | `/clips/:id?media=1` | owner | removes the listing; with `media=1` also calls Nookara `DELETE /media/:mediaId` with the caller's token |
| GET | `/me/clips` | yes | owner's clips incl. unlisted (reconciled against /media/list) |
| GET | `/clips?sort=new\|top&game=&q=&cursor=` | no | public clips only |
| GET | `/clips/:id` | no | public or unlisted; 404 when deleted / media gone |
| POST | `/clips/:id/view` | no | view counter (rate-limited per IP via CF-Connecting-IP) |
| GET | `/users/:username` | no | Nookara profile basics + public clips (respect friends-only/private Nookara profiles: show name/avatar only) |
| GET | `/games` | no | games that have public clips, with counts + icons |
| GET | `/me` | yes | (added by backend) `{user:{id, username, avatar, color, rank, profileUrl}}` - web sign-in check |

Clip ids: 10-char random base62. Thumbnails stored by the backend (`/api/thumb/<id>.jpg`).

### Backend details (as implemented)
- `POST /clips`: `videoUrl` must start with `https://nookara.cc/uploads/videos/` and be a video in the caller's
  `/media/list`. Re-posting the same media returns **200** `{id, url, existing:true}` (safe to retry); new = **201**.
  `title` <= 100 chars (empty -> "Untitled clip"), `game` <= 64 (empty -> "Other"), `durationSec` 0-3600, `width`/`height`
  ints 16-8192, `thumbnail` optional JPEG data URL <= 300 KB, `gameIcon` optional PNG/JPEG/WebP data URL <= 128 KB or https URL.
  Body limit 1 MB. Rate limits: 20 creates/hour/user, 30/hour/IP; 300 API req/min/IP.
- Errors are `{error:'<code>'}`: 400 `invalid_video_url|invalid_duration|invalid_dimensions|invalid_visibility|invalid_thumbnail|invalid_game_icon|media_not_found|bad_json`,
  401 `unauthorized`, 403 `forbidden|tos_required|banned`, 404 `not_found`, 413 `thumbnail_too_large|body_too_large`,
  429 `rate_limited` (+ `retryAfter`), 502 `velora_unreachable|media_delete_failed`.
- Clip object: `{id, url, title, game, gameIcon, durationSec, width, height, visibility, views, createdAt, videoUrl, thumbnail,
  user:{id, username, avatar, color, profileUrl}}`; `/me/clips` and PATCH responses also carry `mediaId` (+ `trim`, `audioTracks` on drafts). Every clip has `status` (`ready|rendering|failed`, see v1.1).
- `GET /clips` -> `{clips, nextCursor}` (24 per page, pass `cursor` back). `DELETE` -> `{ok, mediaDeleted}`; if Nookara refuses
  the media delete the clip is kept and you get 502 `media_delete_failed`. `POST /clips/:id/view` -> `{views, counted}`.
- Installer files: put `latest.json` + `Glint-Setup-<version>.exe` in the backend's download folder (`DOWNLOAD_DIR`)
  (the web server serves that folder statically; `/download` without a slash is the web download page).

## Web routes (served by the backend so share links get OpenGraph/Twitter video meta)
`/` browse · `/c/<id>` clip viewer · `/u/<username>` profile · `/download` app download page.

## Desktop updates
`https://clips.nookara.cc/download/latest.json` = `{version, url, sha256, size, notes}`; installer at
`/download/Glint-Setup-<version>.exe`. Releases are published by the Nookara team.

## Look
Nookara site style: dark, account accent colour (`/account/me` profile.color → `--accent`), **no border-radius anywhere**,
**no emoji/symbol icons** (lucide SVG only), same fonts as nookara.cc.

## v1.1 additions (2026-10-28) — multi-track audio + drafts

### Multi-track clips (desktop)
- Recorded clips are MP4 with 1 video stream + **one AAC stream per audio source**, in this order of kinds:
  `game` (game process tree loopback), `mic`, `discord`, `fluxer`, `ember` (each = that app's process loopback, only present
  if it was running), `desktop` (whole system mix, opt-in). Each audio stream carries `title=<label>` metadata and the
  desktop library stores `audioTracks:[{index, kind, label, enabled, volume}]` per clip.
- Local edits are non-destructive: `trim:{start,end}` (seconds) + per-track `enabled`/`volume` live in the library.
- **Public/unlisted uploads** = desktop renders the final MP4 (trim applied, enabled tracks mixed into ONE AAC track at
  their volumes) and uploads that. **Draft uploads** = desktop uploads the ORIGINAL multi-track MP4 untouched, plus
  `trim` + `audioTracks` in the POST body, so the web editor can untrim / re-toggle sources.

### Drafts (backend + web)
- `visibility` may be `'draft'`. Drafts are never listed anywhere; `GET /clips/:id` on a draft = 404 unless the caller is the
  owner. `/me/clips` includes them (`visibility:'draft'`).
- `POST /clips` extra optional fields: `trim:{start,end}`, `audioTracks:[{index,kind,label,enabled,volume}]` (max 8).
- `PATCH /clips/:id` on a draft also accepts `trim` and `audioTracks` (enabled/volume) — saves edit state only.
- `GET /clips/:id/edit` (owner) → `{clip, trim, audioTracks, proxy:{video, tracks:[{index, url}]}}`. The backend builds
  proxies on first request with ffmpeg (`<data dir>/drafts/<id>/`): a video-only low-bitrate MP4 (~720p, keyframe
  every 1 s for fast seeking on phones) + one small AAC/M4A per audio track. The web editor plays the muted video with the
  track audio elements kept in sync, so toggling/volume is instant. Proxies deleted after publish/delete or 7 days unused.
- `POST /clips/:id/publish {visibility:'public'|'unlisted', title?}` (owner) → **202** `{status:'rendering'}`. The backend
  downloads the draft from Nookara, renders trim + enabled tracks mixed (libx264 veryfast/CRF ~21 or stream-copy when no trim,
  AAC 160k, +faststart; one render at a time), uploads the result to Nookara `/media/video` chunk+finalize **with the caller's
  token held in memory only for that job**, deletes the old draft media with the same token, swaps `videoUrl`/`mediaId`, sets
  the visibility. Poll `GET /clips/:id` → `status: 'rendering' | 'ready' | 'failed'` (+ `error`). If the token is rejected
  mid-job the clip stays a draft with `status:'failed'`.
- Desktop can also publish a draft it uploaded (same endpoint), or re-upload a rendered version itself.

### Desktop upload settings
`autoUpload: 'off' | 'on_clip' | 'on_game_close'` (default off) + `autoUploadVisibility: 'draft' | 'unlisted' | 'public'`
(default draft).

## v1.1 additions — likes, comments, Ember embeds
- `PUT/DELETE /clips/:id/like` (auth) → `{liked, likes}`; clip objects gain `likes`, `comments` counts and (when authed) `liked`.
- `GET /clips/:id/comments?cursor=` (public/unlisted clips; drafts owner-only) → `{comments:[{id, body, createdAt, user:{id,username,avatar,color,profileUrl}}], nextCursor}`;
  `POST /clips/:id/comments {body}` (auth, 1–500 chars, rate-limited); `DELETE /comments/:id` (comment author or clip owner).
- Clip pages also emit machine-readable meta for Ember's custom embed (in addition to OG/Twitter):
  `<meta name="glint:id">`, `glint:title`, `glint:user`, `glint:user_avatar`, `glint:game`, `glint:game_icon`, `glint:duration`,
  `glint:video` (direct mp4), `glint:thumb`, `glint:likes`, `glint:views`. Drafts/deleted clips emit none (404).

### v1.1 backend notes (as implemented, 2026-10-28)
- `audioTracks[].index` = 0-based ordinal among the file's **audio** streams (ffmpeg `0:a:<index>`), max 8, `volume` 0-2 (1 = 100 %),
  `kind` one of game|mic|discord|fluxer|ember|desktop|other. **The MP4 muxer drops `title` on audio streams** - also write
  `-metadata:s:a:N handler_name=<label>`; the backend reads title, then handler_name, to label tracks it wasn't told about.
- Clip objects: `status` + `error` (when failed) + `progress:{phase:'queued'|'downloading'|'rendering'|'uploading'|'finishing', pct}`
  (while rendering), `likes`, `comments`, `liked` (authed). `GET /clips/:id?expand=1` adds `uploaderStats{clips,views,likes}` and
  `gameStats{clips,views,likes}`. Draft thumbnails are signed URLs (owner only).
- `GET /clips?user=<name>` filter (in addition to `q`, `game`, `sort`); `q` ranks exact game/uploader matches, then prefixes, then contains.
  `sort=top` = views + 5*likes + 3*comments.
- `GET /clips/:id/edit` -> `proxy.status: 'queued'|'building'|'ready'|'failed'` (+ `progress`, `position`, `error`); `video`/`tracks`/
  `filmstrip` (10-frame sprite) are signed same-origin URLs once ready, null before - poll ~1.5 s. `?retry=1` after a failure.
  409 `not_a_draft` for published clips.
- `PATCH` on drafts: `visibility` changes are refused with 400 `use_publish`; while rendering PATCH/DELETE/publish = 409 `rendering`.
- Publish job errors (`error`): `storage_limit_exceeded`, `token_rejected`, `pro_only`, `upload_forbidden`, `file_too_large`,
  `velora_unreachable`, `upload_failed`, `render_failed`, `source_missing`, `interrupted` (server restarted). An already-final draft
  (no trim, one track at 100 %) is published by flipping visibility, no re-upload. Rate limit 20 publishes/hour/user.
- Comments: `{id (number), body, createdAt, user}`, 20 per page newest first, `nextCursor` = id to pass back. Bodies are plain text
  (trimmed, max 2 blank lines in a row). Errors 400 `empty_comment|comment_too_long`. Limits: 10 comments / 10 min / user,
  30 like toggles / min / user. Deleting a clip deletes its comments + likes.

## v1.1.1 — desktop publishes drafts by rendering locally
- `POST /clips/:id/replace` (owner) `{videoUrl, visibility:'public'|'unlisted', durationSec, width, height, thumbnail?, title?}`:
  the desktop rendered the final MP4 itself (trim + enabled tracks mixed) and uploaded it to Nookara media. Backend checks
  `videoUrl` is in the caller's `/media/list`, swaps `videoUrl`/`mediaId`, deletes the OLD draft media with the caller's token
  (best effort; reports `oldMediaDeleted`), clears draft trim/audioTracks/proxies, sets visibility + status 'ready'.
  Works on drafts and on failed publishes. → `{clip, oldMediaDeleted}`.
- The app's Publish button uses this (local render), never the server render. `POST /clips/:id/publish` (server render)
  stays for the web/mobile editor only.

### v1.1.1 backend notes (as implemented)
- `POST /clips/:id/replace` errors: 409 `not_a_draft` / `rendering` / `media_in_use`, 400 `media_not_found` / `same_media` /
  `invalid_visibility` / `invalid_dimensions` / `invalid_duration` / `invalid_thumbnail` / `invalid_title`, 404 for non-owners.
  Shares the publish rate limit (20/hour/user). `width`/`height`/`durationSec` describe the rendered file.
- Server renders (`/publish`) are memory-capped (decoder + x264 2 threads, rc-lookahead 10) and re-encodes are capped at 1440p
  (width/height are updated to the output). An ffmpeg crash or OOM kill = `status:'failed'`, `error:'render_failed'`.
- **Ember (browser) access:** `/api/*` (and the old `/glint/api/*`) answers CORS for Ember's origins only (Apache `<Location /api/>`:
  methods GET/PUT/DELETE/OPTIONS, headers Authorization + Content-Type, max-age 600, `Vary: Origin`, no credentials). Any valid
  Nookara token works (Ember's included) - no scope beyond a valid session is needed. `/me/clips` reconciles against Nookara's
  `/media/list` at most once per 60 s per token, so it's fine to call whenever a picker opens; each clip has `thumbnail`, `videoUrl`,
  `mediaId`, `durationSec`, `width`, `height`, `game`, `gameIcon`, `visibility`, `likes`, `comments`, `views`, `createdAt`, `status`.

## v1.1.4 — custom app audio tracks
- New audio track kind **`app`**: a user-chosen program's process-loopback (e.g. Spotify). Track object adds
  `app: {exe:'Spotify.exe', name:'Spotify'}` and optional `icon` (PNG data URL, ≤ 16 KB, 32-64 px, from the exe icon).
  Max 8 audio tracks total still applies. Backend must accept kind `app` (+ these fields) on POST/PATCH and in the editor
  payload; web editor shows the `icon` if present, else a lucide `app-window` icon, with the label.

## v1.1.8 — crop
- Clips can carry a non-destructive `crop: {x, y, w, h}` in SOURCE pixels (integers, even numbers, inside the frame,
  w/h ≥ 64), stored with trim in the desktop library. Public/unlisted renders on the PC apply it. Draft uploads send the
  original + `crop` (like trim); `PATCH` on a draft accepts `crop` (or `null` to clear). Server publish renders apply it
  (`crop=w:h:x:y` before scaling). `GET /clips/:id/edit` returns it. The web editor shows the crop in the preview and can
  edit or reset it.

### v1.1.8 backend notes (as implemented) + liked clips
- `crop` is validated against the clip's `width`/`height` (400 `invalid_crop`); a full-frame crop is stored as `null`. Returned on
  owner draft objects (`/clips/:id` with the owner's token, `/me/clips`, PATCH responses) and as `crop` in `GET /clips/:id/edit`.
  PATCH `crop` on a non-draft = 400 `not_a_draft`. Server renders apply `crop=w:h:x:y` then the 1440p cap; a crop alone forces a
  re-encode (no visibility-flip shortcut). The editor previews the crop as an overlay on the uncropped proxy. `/replace` clears it.
- `GET /me/likes?cursor=` (auth) -> `{clips, nextCursor}`: clips the caller liked, newest like first, 24 per page, only ones that
  still exist and are public/unlisted; each has `liked:true` + `likedAt`. Web: `/liked`, "Liked clips" in the account menu,
  and an owner-only "Liked" tab on your own profile (`?tab=liked`).
