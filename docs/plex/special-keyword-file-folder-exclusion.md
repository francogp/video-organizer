# Special Keyword File/Folder Exclusion

> Support Articles

When scanning a directory of personal media files for a Plex Media Server library, Plex will automatically ignore and exclude certain content:

- Files that include the word `sample` in the filename and are less than 300MB in size
- Folders that include the words `extras`, `samples`, `bonus`, or `bonus disc`
- Sub-folders that do _not_ follow the syntax described in the [Local Files for Movie Trailers and Extras](https://support.plex.tv/articles/local-files-for-trailers-and-extras/) article
- Disk image content:
  - Files that have the suffix `.dvdmedia`, `.iso`, or `.img` (and other disk image formats)
  - Sub-folders for disk image formats (`VIDEO_TS`, `BDMV`, etc.)

Currently these filters are excluded before metadata matching begins.

Only a very few select number of videos are affected by this and and when something is ignored unexpectedly, there is often a simple workaround. Usually, simply renaming the file or directory to not include one of the above keywords is enough to have Plex start recognizing and handling the file.

**Related Page**: [Local Media Assets - Movies](https://support.plex.tv/articles/200220677-local-media-assets-movies/)

**Related Page**: [Local Files for Movie Trailers and Extras](https://support.plex.tv/articles/local-files-for-trailers-and-extras/)

**Related Page**: [Why are ISO, VIDEO\_TS, and other Disk Image Formats Not Supported?](https://support.plex.tv/articles/201426506-why-are-iso-video-ts-and-other-disk-image-formats-not-supported/)

## Excluding New Content with .plexignore

**Warning**: This is an advanced feature and is not intended for general users.

When scanning in new content for your libraries, you can tell the scanner to ignore files or patterns by adding a .plexignore file to any folder in your library’s content location. “`.plexignore`” is the exact name of the file to use; nothing more and nothing less (e.g. it starts with a period and does not have a separate “file extension”).

If you add the “.plexignore” file to the root (top-level) folder in the content location, the ignore rules will apply to all sub-folders.

**Note**: Many text editors (e.g. Notepad and Text Edit) will save files with a .txt extension by default. In such a case, you’ll need to manually rename the file to `.plexignore` _exactly_ by removing the extension. (If you leave it as “plexignore.txt” or “.plexignore.txt” it will not work.)

Add one pattern per line for things you’d like to ignore. The file is interpreted as follows:

- Blank lines are ignored.
- Lines starting with # are comments.
- The `*` character is a wildcard.
- Patterns without the forward-slash (`/`) character (e.g. `*.mkv`) match filenames in the same directory as the .plexignore file, or anywhere in the tree if .plexignore is a root of the section.
- Patterns with the forward-slash (`/`) character (e.g. `somedir/*`) match directory and file patterns relative to the directory containing the .plexignore file.

**Tip!**: Always use forward-slashes (`/`) as path delimiters, even on Windows.

Example contents of a `.plexignore` file:

```text
# Ignore all files with "trailer" in the name
*trailer*

# Ignore files with the extension ".cr2"
*.cr2

# Ignore directories called "Modified"
*Modified/*

# Ignore all ".tif" files in the "thumbnails" subdirectory
*thumbnails/*.tif
```

Share this

Was this article helpful?

[Yes](https://support.plex.tv/articles/201381883-special-keyword-file-folder-exclusion/#vote) [No](https://support.plex.tv/articles/201381883-special-keyword-file-folder-exclusion/#)

1000
You've already provided feedback for this article, thank you for helping us improve our articles.Thank you for helping us improve our articles.Thank you for helping us improve our articles! We'll take it from here.You've already provided feedback for this article, thank you.Looks like you already left that comment.
To vote if this article was helpful, please [sign in](https://www.plex.tv/sign-in/?forward=https://support.plex.tv/articles/201381883-special-keyword-file-folder-exclusion/) with your plex account.

Last modified on: February 18, 2026
