# Plex Video Organizer

A self-hosted, Dockerized NAS media organizer that scans staging video folders, enriches metadata via OMDb/TVDb, inspects audio and subtitle tracks with `ffprobe`, remuxes streams losslessly with `ffmpeg`, and outputs Plex-compliant Movies and TV Shows libraries.

## Features

- **Plex Naming Compliance**: Formats Movies and TV Shows (`Standard`, `Specials` / `Season 00`, `Multi-Episode`, `Date-Based`, `{edition-...}`, `{imdb-...}`, `{tvdb-...}`, `{tmdb-...}`, and split parts `- ptN`).
- **Subtitle & Audio Track Management**: Inspects internal audio/subtitle streams and sidecar subtitles (`.srt`, `.ass`, `.ssa`, `.sub`, `.idx`, `.vtt`), normalizes encodings to UTF-8, resolves language codes (ISO 639-2), and supports `keep-and-add` or `replace` merge modes.
- **Scanner Directives**: Honors `.plexignore` exclusion rules and `.plexmatch` series/episode hints.
- **Lossless Video & Flexible Audio Remuxing**: Uses `ffmpeg` lossless video stream copy (`-c:v copy`) into MKV by default (`Copy (original)` audio), with optional per-track Peak Gain or 2-pass EBU R128 Loudnorm normalization (`-16 LUFS`).
- **Pre-Flight Conflict Resolution**: Detects existing destination files and intra-batch collisions before writing, allowing explicit per-item `overwrite` or `ignore` decisions.
- **Real-Time Web UI (Organizer & Verifier)**: Vue 3 + Pinia dashboard with two tabs — **Organizer** (live SSE progress with FFmpeg Pass 1/2 tracking, ETA, cooperative `Cancel Job` preserving completed items, virtualized tables, `Movie` / `Series` classification, automatic `Animated Movies` / `Animated Series` reclassification from metadata, audio Loudnorm/Peak analysis, and batch editing) and **Verifier** (full-library Plex naming compliance audit, empty directory deletion, and bottom-up rename fixer).

## Requirements

- **Production (Docker)**: Docker Engine and Docker Compose v2.
- **Local Development**: Node.js `>= 26.0.0`, `ffmpeg`, and `ffprobe` available in `PATH`.
- **Network & Security Scope (LAN Only)**: Designed strictly for trusted local area networks (LAN). The web console and `/api/*` endpoints do not enforce HTTP authentication (`X-Client-Id` is only an optimistic collaborative lock) — never expose `APP_PORT` directly to the public Internet without an authenticating reverse proxy.

## Configuration (`.env`)

Copy `.env.example` to `.env` and adjust the values for your environment:

```bash
cp .env.example .env
```

### Environment Variables

| Variable                           | Default                         | Description                                                                                                                                                          |
| :--------------------------------- | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_PORT`                         | `3000`                          | HTTP port exposed by the backend server and Docker container.                                                                                                        |
| `DEV_CLIENT_PORT`                  | `5173`                          | Vite development server port (used by `npm run dev`).                                                                                                                |
| `PUID`                             | `1000`                          | Host user ID mapped inside the Docker container (`"${PUID}:${PGID}"`). On Windows (Docker Desktop), set `0` so NTFS bind mounts inherit your Windows user ownership. |
| `PGID`                             | `1000`                          | Host group ID mapped inside the Docker container (`"${PUID}:${PGID}"`). On Windows (Docker Desktop), set `0` to avoid Administrator prompts when deleting files.     |
| `HOST_CONFIG_PATH`                 | `./data/config`                 | Host path mounted to persistent app config in Docker.                                                                                                                |
| `HOST_INPUT_PATH`                  | `./data/input`                  | Host staging path mounted to `/input` in Docker.                                                                                                                     |
| `HOST_OUTPUT_MOVIES_PATH`          | `./data/output/movies`          | Host path for standard movies output library.                                                                                                                        |
| `HOST_OUTPUT_DOCUMENTARIES_PATH`   | `./data/output/documentaries`   | Host path for documentaries output library.                                                                                                                          |
| `HOST_OUTPUT_ANIMATED_MOVIES_PATH` | `./data/output/animated-movies` | Host path for animated movies output library.                                                                                                                        |
| `HOST_OUTPUT_TV_SHOWS_PATH`        | `./data/output/tv-shows`        | Host path for standard TV shows output library.                                                                                                                      |
| `HOST_OUTPUT_ANIMATED_SERIES_PATH` | `./data/output/animated-series` | Host path for animated series output library.                                                                                                                        |
| `OMDB_API_KEY`                     | `""`                            | Optional OMDb API key for movie/series lookup.                                                                                                                       |
| `TVDB_API_KEY`                     | `""`                            | Optional TVDb v4 API key for series and episode lookup (IMDb Suggestions and TVmaze work without keys).                                                              |

### NAS & Host File Permissions (`PUID` / `PGID`)

The container runs as `"${PUID}:${PGID}"`. If these values do not match the owner or group with write access on your mounted host/NAS folders, operations such as moving files or renaming folders in **Verifier** will fail with `EACCES: permission denied`.

| Platform / NAS                 | Recommended `PUID` | Recommended `PGID` | Notes                                                                                                                                                                                                                                                                     |
| :----------------------------- | :----------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Windows (Docker Desktop)**   | `0`                | `0`                | NTFS bind mounts inherit your Windows user ownership; `0:0` avoids `EACCES` and Administrator deletion prompts. (If files live inside WSL2 ext4, match your WSL user via `id -u` / `id -g`, usually `1000:1000`.)                                                         |
| **Linux (Desktop / Server)**   | `1000`             | `1000`             | Run `id -u` and `id -g` as the user that owns your media/staging directories.                                                                                                                                                                                             |
| **QNAP NAS (QTS / QuTS hero)** | `1000` (or `0`)    | `100` (or `0`)     | Run `id <username>` over SSH. Regular QNAP users are typically `1000` (or `500`+ on older QTS) with primary group `100` (`everyone`). `0:0` maps to `admin`. Ensure the shared folder grants Read/Write access (and check Advanced Folder Permissions / ACLs if enabled). |
| **Synology NAS (DSM)**         | `1026`             | `100`              | Run `id <username>` over SSH; `1026` is typically the first created user and `100` is the `users` group.                                                                                                                                                                  |
| **Unraid**                     | `99`               | `100`              | Standard Unraid share permissions (`nobody:users`).                                                                                                                                                                                                                       |
| **TrueNAS SCALE**              | `568`              | `568`              | Default `apps:apps` user/group, or match the UID/GID owning your media dataset.                                                                                                                                                                                           |

### Example NAS `.env`

```dotenv
APP_PORT=3000
DEV_CLIENT_PORT=5173
PUID=1000
PGID=1000

CONFIG_DIR=/mnt/user/appdata/video-organizer
INPUT_DIR=/mnt/user/downloads/staging
BACKUP_DIR=/mnt/user/downloads/backup
OUTPUT_MOVIES_DIR=/mnt/user/media/Movies
OUTPUT_ANIMATED_MOVIES_DIR=/mnt/user/media/Animated Movies
OUTPUT_TV_SHOWS_DIR=/mnt/user/media/TV Shows
OUTPUT_ANIMATED_SERIES_DIR=/mnt/user/media/Animated Series

OMDB_API_KEY=your_omdb_key
TVDB_API_KEY=your_tvdb_key
```

## Running with Docker Compose

### Option A: Prebuilt Image (Arcane, Container Station, Portainer — No Git Required)

GitHub Actions automatically builds and publishes multi-architecture images (`linux/amd64`, `linux/arm64`) to `ghcr.io/francogp/video-organizer:latest` on every push to `main` or release tag `v*`. You do **not** need `git` or local compilation on your NAS.

#### Complete `compose.yaml`

```yaml
services:
  video-organizer:
    image: ghcr.io/francogp/video-organizer:latest
    container_name: plex-video-organizer
    user: '${PUID:-1000}:${PGID:-1000}'
    restart: unless-stopped
    ports:
      - '${APP_PORT:-3000}:${APP_PORT:-3000}'
    environment:
      APP_PORT: '${APP_PORT:-3000}'
      OMDB_API_KEY: '${OMDB_API_KEY:-}'
      TVDB_API_KEY: '${TVDB_API_KEY:-}'
      CONFIG_DIR: /config
      INPUT_DIR: /data/input
      BACKUP_DIR: /data/backup
      OUTPUT_MOVIES_DIR: /data/output/movies
      OUTPUT_ANIMATED_MOVIES_DIR: /data/output/animated-movies
      OUTPUT_TV_SHOWS_DIR: /data/output/tv-shows
      OUTPUT_ANIMATED_SERIES_DIR: /data/output/animated-series
    volumes:
      - '${CONFIG_DIR:-./data/config}:/config'
      - '${INPUT_DIR:-./data/input}:/data/input'
      - '${BACKUP_DIR:-./data/backup}:/data/backup'
      - '${OUTPUT_MOVIES_DIR:-./data/output/movies}:/data/output/movies'
      - '${OUTPUT_ANIMATED_MOVIES_DIR:-./data/output/animated-movies}:/data/output/animated-movies'
      - '${OUTPUT_TV_SHOWS_DIR:-./data/output/tv-shows}:/data/output/tv-shows'
      - '${OUTPUT_ANIMATED_SERIES_DIR:-./data/output/animated-series}:/data/output/animated-series'
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:' + (process.env.APP_PORT || '3000') + '/api/state').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
        ]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
```

#### Complete `.env` Example (NAS / Arcane)

```dotenv
APP_PORT=3000
PUID=1000
PGID=100

# Host folders (QNAP /share/... paths)
CONFIG_DIR=/share/Container/video-organizer/config
INPUT_DIR=/share/Download/ACOMODAR
BACKUP_DIR=/share/Download/ACOMODAR [backup]
OUTPUT_MOVIES_DIR=/share/Multimedia/Movies/Regular
OUTPUT_ANIMATED_MOVIES_DIR=/share/Multimedia/Movies/Animation
OUTPUT_TV_SHOWS_DIR=/share/Multimedia/TV Shows/Regular
OUTPUT_ANIMATED_SERIES_DIR=/share/Multimedia/TV Shows/Animation

# Optional Metadata API Keys (IMDb Suggestions and TVmaze work without keys)
OMDB_API_KEY=
TVDB_API_KEY=
```

#### Deploying & Updating with Arcane

1. Open **Arcane** in your browser and create a new **Project / Stack** (for example `plex-video-organizer`).
2. Paste the **`compose.yaml`** above into the Compose editor.
3. Paste the **`.env`** variables above into the **Environment (`.env`)** section, adjusting `PUID`, `PGID`, and your host folder paths.
4. Click **Deploy / Up**. Open `http://<NAS-LAN-IP>:3000` in your browser.
5. **To update later**: click **Pull** (or **Update / Redeploy**) in Arcane to fetch the latest `ghcr.io/francogp/video-organizer:latest` image.

> **Private vs. Public GHCR Package**: When the GitHub package is **Public**, Arcane and Docker pull it without authentication. If you keep the package **Private**, create a GitHub Personal Access Token with `read:packages` and add `ghcr.io` credentials once under **Arcane -> Settings -> Registries** (or run `docker login ghcr.io` on the host).

### Option B: Build from Source (Local Clone)

```bash
cp .env.example .env
# Edit .env with your host paths and API keys
docker compose up -d --build
```

Open `http://localhost:3000` (or your configured `APP_PORT`) in a browser.

## Production Deployment Scripts (Linux)

For Linux hosts or NAS servers, the repository includes idempotent deployment scripts:

- **First-time install** (installs Docker if missing, enables `docker` service, creates `.env` from `.env.example`, validates Compose config, builds and starts the stack):

  ```bash
  sudo ./deploy-install.sh
  ```

- **Update an existing deployment** (fetches `origin/<branch>`, resets working tree cleanly, preserves `.env` and volumes, rebuilds and restarts containers, verifies `/api/state`):

  ```bash
  ./deploy-update.sh        # defaults to 'main'
  ./deploy-update.sh dev    # optional custom branch
  ```

## QNAP NAS Installation & Permissions Guide (QTS / QuTS hero)

For QNAP NAS devices, the recommended approach is running the stack with **Container Station** (Docker Compose) over SSH so you have full control over volume mounts and `PUID`/`PGID` ownership.

### 1. Prerequisites on QNAP

1. Install **Container Station** from the QNAP **App Center**.
2. Enable **SSH** in **Control Panel -> Network & File Services -> Telnet / SSH**.
3. Connect to the NAS via SSH and verify the real mount path of your shared folders (for example `/share/CACHEDEV1_DATA/...` or `/share/ZFS530_DATA/...` on QuTS hero):

   ```bash
   ls -la /share/
   ```

### 2. Recommended Directory Layout

Keep app configuration on your Container/SSD share and keep staging, backup, and Plex media libraries under your main media share (ideally on the same storage pool/volume):

```text
/share/Container/video-organizer/
├── app/                   # Cloned git repository
└── config/                # HOST_CONFIG_PATH (queue.json, scan cache)

/share/Media/
├── Staging/               # HOST_INPUT_PATH (incoming downloads to organize)
├── Backup/                # HOST_BACKUP_PATH (7-day retention backups)
├── Movies/                # HOST_OUTPUT_MOVIES_PATH
├── Documentaries/         # HOST_OUTPUT_DOCUMENTARIES_PATH
├── Animated Movies/       # HOST_OUTPUT_ANIMATED_MOVIES_PATH
├── TV Shows/              # HOST_OUTPUT_TV_SHOWS_PATH
└── Animated Series/       # HOST_OUTPUT_ANIMATED_SERIES_PATH
```

### 3. Configuring User, `PUID` / `PGID`, and Folder Permissions

1. In QTS/QuTS hero, open **Control Panel -> Privilege -> Users** and create a dedicated user (for example `media-organizer`) or select the existing user that owns your Plex media folders.
2. Open **Control Panel -> Privilege -> Shared Folders -> Edit Shared Folder Permission** and grant **Read/Write (RW)** access to that user on both `Container` and `Media` (and apply to subfolders if **Advanced Folder Permissions** or **Windows ACL** is enabled).
3. Over SSH, inspect the exact numeric UID/GID of that user (on QNAP, regular users are typically `1000`+ with primary group `100` `everyone`):

   ```bash
   id media-organizer
   # Example output: uid=1000(media-organizer) gid=100(everyone) groups=100(everyone)
   ```

4. Ensure the app config and staging directories are owned by that UID/GID so `ffmpeg`, file moves, and **Verifier** bottom-up renames never fail with `EACCES`:

   ```bash
   mkdir -p /share/Container/video-organizer/config \
     /share/Media/Staging /share/Media/Backup \
     /share/Media/Movies /share/Media/Documentaries \
     "/share/Media/Animated Movies" "/share/Media/TV Shows" "/share/Media/Animated Series"

   chown -R 1000:100 /share/Container/video-organizer/config /share/Media/Staging /share/Media/Backup
   ```

### 4. Example QNAP `.env` and Startup

With the prebuilt GHCR image, you do not need `git` on QNAP: paste the `compose.yaml` and `.env` from **Option A** above into **Arcane** or **Container Station -> Applications -> Create**, or create `/share/Container/video-organizer/compose.yaml` and `/share/Container/video-organizer/.env` via SSH:

```dotenv
APP_PORT=3000
PUID=1000
PGID=100

CONFIG_DIR=/share/Container/video-organizer/config
INPUT_DIR=/share/Download/ACOMODAR
BACKUP_DIR=/share/Download/ACOMODAR [backup]
OUTPUT_MOVIES_DIR=/share/Multimedia/Movies/Regular
OUTPUT_ANIMATED_MOVIES_DIR=/share/Multimedia/Movies/Animation
OUTPUT_TV_SHOWS_DIR=/share/Multimedia/TV Shows/Regular
OUTPUT_ANIMATED_SERIES_DIR=/share/Multimedia/TV Shows/Animation

OMDB_API_KEY=your_omdb_key
TVDB_API_KEY=your_tvdb_key
```

Start (or update) the container without building locally:

```bash
cd /share/Container/video-organizer
docker compose pull
docker compose up -d
```

Then open `http://<QNAP-LAN-IP>:3000` in your browser. (You can also manage or inspect the running `plex-video-organizer` stack from **Container Station -> Containers**.)

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts both:

- Backend API server (`dev:server`) on `APP_PORT` (`3000` by default) with `--watch`
- Frontend Vite dev server (`dev:client`) on `DEV_CLIENT_PORT` (`5173` by default), proxying `/api` requests to the backend

## Scripts & Verification

- `npm run dev` — Run backend + frontend concurrently for development.
- `npm run start` — Start the production Node.js server (`src/server/index.ts`).
- `npm run test` — Run the Vitest suite.
- `npm run test:coverage` — Run tests with V8 coverage thresholds.
- `npm run build` — Run full pre-build audit, Vite production build, and post-build checks.
- `npm run fmt` — Format source files.
- `npm run auditor:lint` — Run repository static analysis and governance checks.
