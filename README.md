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

HOST_CONFIG_PATH=/mnt/user/appdata/video-organizer
HOST_INPUT_PATH=/mnt/user/downloads/staging
HOST_OUTPUT_MOVIES_PATH=/mnt/user/media/Movies
HOST_OUTPUT_DOCUMENTARIES_PATH=/mnt/user/media/Documentaries
HOST_OUTPUT_ANIMATED_MOVIES_PATH=/mnt/user/media/Animated Movies
HOST_OUTPUT_TV_SHOWS_PATH=/mnt/user/media/TV Shows
HOST_OUTPUT_ANIMATED_SERIES_PATH=/mnt/user/media/Animated Series

OMDB_API_KEY=your_omdb_key
TVDB_API_KEY=your_tvdb_key
```

## Running with Docker Compose

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

```bash
cd /share/Container/video-organizer/app
cp .env.example .env
```

Set `.env` using your resolved `PUID`/`PGID` and `/share/...` paths:

```dotenv
APP_PORT=3000
DEV_CLIENT_PORT=5173

PUID=1000
PGID=100

HOST_CONFIG_PATH=/share/Container/video-organizer/config
HOST_INPUT_PATH=/share/Media/Staging
HOST_BACKUP_PATH=/share/Media/Backup
HOST_OUTPUT_MOVIES_PATH=/share/Media/Movies
HOST_OUTPUT_DOCUMENTARIES_PATH=/share/Media/Documentaries
HOST_OUTPUT_ANIMATED_MOVIES_PATH=/share/Media/Animated Movies
HOST_OUTPUT_TV_SHOWS_PATH=/share/Media/TV Shows
HOST_OUTPUT_ANIMATED_SERIES_PATH=/share/Media/Animated Series

OMDB_API_KEY=your_omdb_key
TVDB_API_KEY=your_tvdb_key
```

Build and start the container:

```bash
docker compose up -d --build
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
