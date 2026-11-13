# Match Hinting for TV Series

> Support Articles

Plex Media Server versions 1.25.9 and newer provide a match-hinting feature that can help advanced users gain more control over how their TV series files are scanned and matched. This is done by creating simple text files named (exactly) “`.plexmatch`“.

**Warning**: This is an advanced feature; most libraries will not require you to use it.

## Creating a `.plexmatch` file

Match hinting is controlled by text files with the exact name `.plexmatch` located in either a series directory or a season directory. Each `.plexmatch` file affects matching for the directory it’s in; a `.plexmatch` file at the top level of a series also affects directories beneath it. For instance, imagine a setup with this directory structure:

```text
/TV Shows
   /ShowName
      .plexmatch
      /Season 1
         Show S01E01.mkv
      /Season 2
         .plexmatch
         S02E01.mkv
```

The `.plexmatch` file in the `ShowName` directory would affect matching for both media files, while the one in `ShowName/Season 2` would affect only `S02E01.mkv`.

**Note**: Many text editors (e.g. Notepad and TextEdit) will save files with a .txt extension by default. In such a case, you’ll need to manually rename the file to `.plexmatch` _exactly_ by removing the extension. (If you leave it as “plexmatch.txt” or “.plexmatch.txt”, it will not work.)

## File format

A `.plexmatch` file is a line-delimited text file. Leading and trailing whitespace on each line is ignored. Lines that are blank, contain only whitespace, or start with a `#` character (possibly after leading whitespace), are ignored.

Each line may introduce a hint directive. A hint directive is composed of a hint name, a colon, and a hint value; like so:

```text
hint1: value1
hint2: value2
hint3: value3
```

Whitespace at the start and end of the hint name and hint value is ignored. Hint names are case-insensitive.

## Series and season match hinting

Series and season match hinting allows you to tell Plex Media Server what series and season a directory contains with precision. Match hint information provided in a `.plexmatch` file overrides the directory and filenames, allowing greater control over matching without requiring you to rename your existing files.

Several match hints are supported:

- `title` and `show` are synonymous. Either one can be used to set the title of the series for matching purposes, overriding the series directory name.
- `season` sets the season number. This would normally be used in a season directory (overriding any number provided by the directory name), particularly when using a separate top-level directory for each season in a series (rather than grouping them all under a series directory as usual).
- `year` sets the release year of the series.
- `tvdbid`, `tmdbid`, and `imdbid` set the numeric ID of the series from TheTVDB, The Movie Database, or IMDb. This overrides any `title` or `year` hints, as well as the series directory name. `imdbid` hints can optionally include the `tt` prefix.
- `guid` sets a Plex URI-style media identification GUID, in the format `[source]://[id]`.

For example, a file that sets the title, year, and season for a top-level directory called `CoolShowSecondSeason` might look like this:

```text
# This directory contains the second season of Cool Show
Title: Cool Show

# The series' first season originally aired in 2018
Year: 2018
Season: 2

# We could also add a tvdbid: hint if we knew the ID for
# Cool Show, but we'd still need to provide the season
# hint as well.
```

## Episode match hinting

Episode match hinting allows you to tell Plex Media Server which particular episode a file (or group of files) contains, even if the scanner would normally be unable to parse their filenames.

### Pattern matching

Beginning in Plex Media Server version 1.30.0, the scanner supports a hint type named `pattern`, or `pt` for short (both names are supported). This is a powerful tool that allows specifying a naming pattern that can match several episodes. Leading and trailing whitespace in the value is ignored.

The hint value is a pattern string, which can contain glob-style `*` wildcards, `/` path separators, and a special kind of value called “match tokens”. Match tokens are wrapped in `{curly braces}`, and allow you to match season and episode numbers from filenames. Special characters (`*`, `\``{`, and `}`) can be escaped using backslashes (`\`).

**Tip!**: Forward-slashes (`/`) will always work as path delimiters, even on Windows.

Backslashes (\\) are used to escape special characters, and will not work as path separators.

Match tokens begin with a token type. The following types are currently supported:

- `s`, `se`, or `season`, indicating a season number; if this is absent, it will be inferred from the parent directory
- `e`, `ep`, or `episode`, indicating an episode number
- `sp`, or `special`, indicating an special number; this is equivalent to `ep` in a Season 0 directory
- `see`, indicating a combined season and episode number (e.g. “214” would refer to season 2, episode 14), beginning in Plex Media Server version 1.30.2

At least one token providing an episode number (either e/ep/episode or sp/special) is required in every matching pattern.

After its name, a match token may include some number of additional parameters, separated by commas. The following types are currently supported:

- Validity ranges, formatted as `[start]-[end]`, indicating an inclusive range of integer values that the pattern will match
- Offsets, formatted as `+[offset]` or `-[offset]`, indicating an integer offset to apply to the matched value
- Maximum lengths, formatted as `l[length]`, indicating a maximum number of numeric characters to match, beginning in Plex Media Server version 1.30.2

If there are multiple patterns that match a filename, the earliest one specified will be used.

#### Example usage

```text
# Bonus clips 1 through 3 are numbered 5 through 8 on TVDB
Pattern: Bonus/Bonus {sp,1-3,+4}.mp4
# Clips 4 through 6 are numbered 10 through 12
Pattern: Bonus/Bonus {sp,4-6,+6}.mp4

# These files use an unusual naming convention
Pattern: Show Part {se} - {ep} - *
```

### Individual file matching

Individual episode match hints are named `episode`, or `ep` for short (both names are supported). The hint value uses the format `simpleEpisodeNumber: filename`. Whitespace before and after the filename is ignored, but the episode number must be followed immediately by the colon.

Supported episode number formats include:

- `SP[X]`, meaning Special (season 0) episode X. e.g. `SP04`.
- `E[X]` or simply `[X]`, meaning episode X of the current directory’s season (defaulting to 1). e.g. `E02`, or simply `02`.
- `S[X]E[Y]`, meaning episode Y of season X. e.g. `S03E04`.

All formats also support a trailing hyphen-separated continuation string specifying that a file contains a range of episodes. Supported formats include:

- `E[X]` or simply `[X]`, meaning a file contains multiple episodes of the current season. e.g. `S01E01-E02`, or `01-02`.
- `S[X]E[Y]`, meaning a file contains multiple episodes of the specified season. e.g. `S03E12-S03E13`.

When the filename specified by an episode hint matches the name of a file in the directory, that file will be scanned in using the episode number specified in the hint, ignoring any number that would normally be parsed from the filename. If present, a season number specified in the hint will also override any season number in the filename, as well as in the directory name or in a `season` hint. For instance:

```text
# Regular episodes with tricky filenames
Episode: 01: Pilot.mkv
ep: 12: Episode 12 - Finale Part 2.mkv

# Specials
ep: SP01: Some Unnumbered Special.mkv
ep: SP03: Some Special Subseries 1.mkv
ep: SP04: Some Special Subseries 2.mkv
```

The `.plexmatch` file for a series directory may specify episode hints for any file beneath it by using a relative path:

```text
ep: SP02: Season 1/Bonus/Bonus Clip 1.mkv
ep: SP04: Season 2/Bonus/Bonus Clip 1.mkv
```

**Tip!**: Forward-slashes (`/`) will always work as path delimiters, even on Windows.

Backslashes (\\) only work on Windows, so you may want to avoid them.

Any `.plexmatch` files in directories below the main series can only specify episode hints for the directory they’re in.
