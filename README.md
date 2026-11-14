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

| Variable                     | Default / Requirement  | Description                                                                                                                                                          |
| :--------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_PORT`                   | `3000`                 | HTTP port exposed by the backend server and Docker container.                                                                                                        |
| `DEV_CLIENT_PORT`            | `5173`                 | Vite development server port (used by `npm run dev`).                                                                                                                |
| `PUID`                       | `1000`                 | Host user ID mapped inside the Docker container (`"${PUID}:${PGID}"`). On Windows (Docker Desktop), set `0` so NTFS bind mounts inherit your Windows user ownership. |
| `PGID`                       | `1000`                 | Host group ID mapped inside the Docker container (`"${PUID}:${PGID}"`). On Windows (Docker Desktop), set `0` to avoid Administrator prompts when deleting files.     |
| `CONFIG_DIR`                 | **Required in `.env`** | Writable host path mounted to `/config` in Docker (`queue.json`, scan caches).                                                                                       |
| `INPUT_DIR`                  | **Required in `.env`** | Host staging path mounted to `/data/input` in Docker.                                                                                                                |
| `BACKUP_DIR`                 | **Required in `.env`** | Host retention backup path (7-day cleanup) mounted to `/data/backup` in Docker.                                                                                      |
| `OUTPUT_MOVIES_DIR`          | **Required in `.env`** | Host path mounted to `/data/output/movies` for standard movies.                                                                                                      |
| `OUTPUT_ANIMATED_MOVIES_DIR` | **Required in `.env`** | Host path mounted to `/data/output/animated-movies` for animated movies.                                                                                             |
| `OUTPUT_TV_SHOWS_DIR`        | **Required in `.env`** | Host path mounted to `/data/output/tv-shows` for standard TV shows.                                                                                                  |
| `OUTPUT_ANIMATED_SERIES_DIR` | **Required in `.env`** | Host path mounted to `/data/output/animated-series` for animated series.                                                                                             |
| `OMDB_API_KEY`               | `""`                   | Optional OMDb API key for movie/series lookup.                                                                                                                       |
| `TVDB_API_KEY`               | `""`                   | Optional TVDb v4 API key for series and episode lookup (IMDb Suggestions and TVmaze work without keys).                                                              |

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

CONFIG_DIR=/mnt/user/appdata/plex-video-organizer
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

GitHub Actions builds and publishes two decoupled multi-architecture images (`linux/amd64`, `linux/arm64`) **on release tags `v*`** (plus independent FFmpeg companion updates via the scheduled/manual `ffmpeg-publish.yml` workflow, never on untagged commits to `main`):

- `ghcr.io/francogp/plex-video-organizer:latest` — hardened rootless Node.js 26 runtime (`read_only: true`, `cap_drop: [ALL]`, pruned of frontend build dependencies and OS-bundled FFmpeg).
- `ghcr.io/francogp/plex-video-organizer-ffmpeg:latest` — lightweight static `ffmpeg` + `ffprobe` init container (`mwader/static-ffmpeg` + `busybox`) that populates the shared `ffmpeg-bin` volume and initializes `/config` ownership.

#### Complete `compose.yaml`

```yaml
name: plex-video-organizer
services:
  ffmpeg-provider:
    image: ghcr.io/francogp/plex-video-organizer-ffmpeg:latest
    container_name: plex-video-organizer-ffmpeg
    restart: 'no'
    environment:
      PUID: '${PUID:-1000}'
      PGID: '${PGID:-1000}'
      CONFIG_DIR: /config
    volumes:
      - ffmpeg-bin:/opt/ffmpeg
      - '${CONFIG_DIR:?Set CONFIG_DIR in .env to a writable host directory}:/config'
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER

  plex-video-organizer:
    image: ghcr.io/francogp/plex-video-organizer:latest
    container_name: plex-video-organizer
    depends_on:
      ffmpeg-provider:
        condition: service_completed_successfully
    user: '${PUID:-1000}:${PGID:-1000}'
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
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
      - ffmpeg-bin:/opt/ffmpeg:ro
      - '${CONFIG_DIR:?Set CONFIG_DIR in .env to a writable host directory}:/config'
      - '${INPUT_DIR:?Set INPUT_DIR in .env to your staging host directory}:/data/input'
      - '${BACKUP_DIR:?Set BACKUP_DIR in .env to your backup host directory}:/data/backup'
      - '${OUTPUT_MOVIES_DIR:?Set OUTPUT_MOVIES_DIR in .env to your movies output host directory}:/data/output/movies'
      - '${OUTPUT_ANIMATED_MOVIES_DIR:?Set OUTPUT_ANIMATED_MOVIES_DIR in .env to your animated movies output host directory}:/data/output/animated-movies'
      - '${OUTPUT_TV_SHOWS_DIR:?Set OUTPUT_TV_SHOWS_DIR in .env to your TV shows output host directory}:/data/output/tv-shows'
      - '${OUTPUT_ANIMATED_SERIES_DIR:?Set OUTPUT_ANIMATED_SERIES_DIR in .env to your animated series output host directory}:/data/output/animated-series'
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

volumes:
  ffmpeg-bin:
```

#### Complete `.env` Example (NAS / Arcane)

```dotenv
APP_PORT=3000
PUID=1000
PGID=100

# Host folders (QNAP /share/... paths)
CONFIG_DIR=/share/Container/plex-video-organizer/config
INPUT_DIR=/share/Download/Staging
BACKUP_DIR=/share/Download/Staging [backup]
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
5. **To update later**: click **Pull** (or **Update / Redeploy**) in Arcane to fetch the latest images (`ghcr.io/francogp/plex-video-organizer:latest` and/or `ghcr.io/francogp/plex-video-organizer-ffmpeg:latest`). You can update `plex-video-organizer-ffmpeg:latest` independently and redeploy the stack without rebuilding or changing the app container image.

> **Private vs. Public GHCR Package**: When the GitHub packages are **Public**, Arcane and Docker pull them without authentication. If you keep the packages **Private**, create a GitHub Personal Access Token with `read:packages` and add `ghcr.io` credentials once under **Arcane -> Settings -> Registries** (or run `docker login ghcr.io` on the host).

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
/share/Container/plex-video-organizer/
├── app/                   # Optional git clone (if building locally)
└── config/                # CONFIG_DIR (queue.json, scan caches)

/share/Media/
├── Staging/               # INPUT_DIR (incoming downloads to organize)
├── Backup/                # BACKUP_DIR (7-day retention backups)
├── Movies/                # OUTPUT_MOVIES_DIR
├── Animated Movies/       # OUTPUT_ANIMATED_MOVIES_DIR
├── TV Shows/              # OUTPUT_TV_SHOWS_DIR
└── Animated Series/       # OUTPUT_ANIMATED_SERIES_DIR
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
   mkdir -p /share/Container/plex-video-organizer/config \
     /share/Media/Staging /share/Media/Backup \
     /share/Media/Movies \
     "/share/Media/Animated Movies" "/share/Media/TV Shows" "/share/Media/Animated Series"

   chown -R 1000:100 /share/Container/plex-video-organizer/config /share/Media/Staging /share/Media/Backup
   ```

### 4. Example QNAP `.env` and Startup

With the prebuilt GHCR image, you do not need `git` on QNAP: paste the `compose.yaml` and `.env` from **Option A** above into **Arcane** or **Container Station -> Applications -> Create**, or create `/share/Container/plex-video-organizer/compose.yaml` and `/share/Container/plex-video-organizer/.env` via SSH:

```dotenv
APP_PORT=3000
PUID=1000
PGID=100

CONFIG_DIR=/share/Container/plex-video-organizer/config
INPUT_DIR=/share/Download/Staging
BACKUP_DIR=/share/Download/Staging [backup]
OUTPUT_MOVIES_DIR=/share/Multimedia/Movies/Regular
OUTPUT_ANIMATED_MOVIES_DIR=/share/Multimedia/Movies/Animation
OUTPUT_TV_SHOWS_DIR=/share/Multimedia/TV Shows/Regular
OUTPUT_ANIMATED_SERIES_DIR=/share/Multimedia/TV Shows/Animation

OMDB_API_KEY=your_omdb_key
TVDB_API_KEY=your_tvdb_key
```

Start (or update) the container without building locally:

```bash
cd /share/Container/plex-video-organizer
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
