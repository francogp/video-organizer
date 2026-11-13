# Purpose

Media inspection, UTF-8 subtitle normalization, and lossless `ffmpeg` remuxing.

## Ownership

Backend Maintainers.

## Local Contracts

- Invoke `ffprobe` and `ffmpeg` strictly via `node:child_process.spawn` with argument arrays (`shell: false`).
- All long-running `ffmpeg` tasks (`measureLoudnormPass1`, `runFfmpegRemux`) must pass `-progress pipe:1` to stream real-time percentage and `etaSeconds` via `runFfmpegProcess`; multi-track `loudnorm` Pass 1 runs in parallel across CPU cores because FFmpeg's `loudnorm` filter is single-threaded per stream.

## Key Files

- [ffmpegRunner.ts](ffmpegRunner.ts): `ffprobe` inspection, UTF-8 subtitle normalization, and `ffmpeg` remux runner.

## Work Guidance

- Always copy video streams losslessly (`-c:v copy`). Default audio normalization to `Copy (original)` (`-c:a copy`), re-encoding audio only when the user selects `peak-gain` or `loudnorm`.

## Verification

- Run `npm run test:coverage` to verify `ffmpegRunner.test.ts`.
