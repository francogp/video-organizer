# Local Files for TV Show Trailers and Extras

> Support Articles

When using the **Plex TV Series** agent you can use your own trailers or extras media files. These can be organized in one of two ways to use them with Plex. Either put them “inline”, alongside the TV episode (in the same season directory as the episode), or in a subdirectory of the main TV show directory.

**Note:** Certain clients do not yet fully support TV extras but keep an eye out on our forum as our support pages will be updated once official support is available.

| Client                        | Show | Season | Episode |
| ----------------------------- | ---- | ------ | ------- |
| Android Mobile, iOS           | •    | •      | •       |
| Roku                          | •    | •      | •       |
| Apple TV, Android TV, Fire TV | •    | •      | •       |
| Plex HTPC, Smart TVs          | •    | •      |         |
| Plex Web, Desktop             | •    |        |         |

## Plex Pass Extras

If you have a Plex Pass subscription you’ll be able to automatically get trailers and extras for shows. Please note that not all shows have extras available. Just ensure you have the Find Extras option enabled in the Advanced section in the TV library’s settings.

**Related:** [Advanced Settings Plex TV Series Agent](https://support.plex.tv/articles/advanced-setting-plex-tv-series-agent/)

## Local Show and Season Extras

You can organize your local extras into specific subdirectories inside the main directory named for the TV show. Extras will be detected and used if named and stored as follows:

- `TV Show (Release Date)/Extra_Directory_Type/Descriptive_name.ext`

Where `Extra_Directory_Type` is one of:

- `Behind The Scenes`
- `Deleted Scenes`
- `Featurettes`
- `Interviews`
- `Scenes`
- `Shorts`
- `Trailers`
- `Other`

**Example:**

```text
/Game of Thrones
   An Interview With Emilia Clarke-interview.mkv
   /Trailers
      Trailer 1.mkv
      Trailer 2.mkv
   /Featurettes
      Special Effects.mkv
   /Season 01
      /Behind The Scenes
         A look at season 1.mkv
      /Deleted Scenes
         Season 1 Deleted Scenes.mkv
```

**Tip!**: When extras are added after the show, season, or episode already exists in your Plex library, you will likely need to trigger the Refresh Metadata action for the show as a whole to have the new content picked up.

## Local Episode Extras

Episode extras can be located alongside the episode file. They’re indicated by using specific naming at the end of the filename which should otherwise be named the same as the episode file. Local inline extras will be detected and used if named and stored as follows:

- `S01E01 - Episode Title-Extra_Type.ext`

Where `-Extra_Type` is one of:

- -behindthescenes
- -deleted
- -featurette
- -interview
- -scene
- -short
- -trailer
- -other

**Note**: The filename must end in the `-Extra_Type` value exactly. The hyphen is important and you cannot have spaces between the hyphen and word.

**Examples:**

```text
Game of Thrones - S01E01 - Winter is Coming.mkv
Game of Thrones - S01E01 - Winter is Coming-deleted.mkv
Game of Thrones - S01E01 - Winter is Coming-featurette.mkv
```

You can add multiple-episode extras of the same type by adding a number index to the end of the suffix:

e.g.

```text
Game of Thrones - S01E01 - Winter is Coming-deleted1.mkv
Game of Thrones - S01E01 - Winter is Coming-deleted2.mkv
Game of Thrones - S01E01 - Winter is Coming-deleted3.mkv
```

Share this

Was this article helpful?

[Yes](https://support.plex.tv/articles/local-files-for-tv-show-trailers-and-extras/#vote) [No](https://support.plex.tv/articles/local-files-for-tv-show-trailers-and-extras/#)

1000
You've already provided feedback for this article, thank you for helping us improve our articles.Thank you for helping us improve our articles.Thank you for helping us improve our articles! We'll take it from here.You've already provided feedback for this article, thank you.Looks like you already left that comment.
To vote if this article was helpful, please [sign in](https://www.plex.tv/sign-in/?forward=https://support.plex.tv/articles/local-files-for-tv-show-trailers-and-extras/) with your plex account.

Last modified on: October 21, 2026
