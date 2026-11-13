# Adding Local Subtitles to Your Media

> Support Articles

If your media library uses the **Plex Movie** (not the “Legacy” one) or **Plex TV Series** agent there is nothing to do in agent settings since detecting subtitles is always enabled for those agents, but must be a supported format, and if external, named correctly as described farther down this article.

## Enable “Local Media Assets” in legacy agents

If your media contains embedded subtitles or you have an external subtitle file, you have local subtitles. To include either of these, ensure the Local Media Assets source is configured as follows:

For enabling in all other agents

- Launch the Plex Web App
- Choose Settings from the top right of the Home screen
- Select your Plex Media Server from the horizontal list
- Choose Agents
- Choose the library type and agent to change
- Ensure Local Media Assets is checked

**Related Page**: [Agents](https://support.plex.tv/articles/200289516-agents/)

### Refresh the Entire Library

If a library didn’t have the Local Media Assets source enabled, the library must be refreshed to pick up the embedded subtitles using “Refresh All Metadata”. See the libraries guide for details.

**Related Page**: [Scanning vs Refreshing a Library](https://support.plex.tv/articles/200289306-scanning-vs-refreshing-a-library/)

## Supported Subtitle Formats

The following formats are fully supported either as embedded tracks or external subtitle files. Full support means they are compatible with all Plex Apps, including clients that require transcoded media.

- SRT (`.srt`)
- SMI (`.smi`)
- SSA (or ASS) (`.ssa` or `.ass`)
- WebVTT (`.vtt`)

Other formats such as VOBSUB, PGS, etc. may work on some Plex apps but not all. For the majority of apps, both VOBSUB and PGS subtitles will require the video to be transcoded to “burn in” the subtitles for streaming.

**Tip!**: You’ll want to make sure a text subtitle file is saved using the UTF-8 character encoding. Other encodings may work, but could also result in strange, unexpected character displays.

**Related Pages**: [Transcoding Media](https://support.plex.tv/articles/200250377-transcoding-media/)

## Embedded Subtitles

Media that have subtitle tracks included within the file are said to have “embedded” subtitle tracks. These are the most convenient way to include subtitles for your content as they are probably perfectly matched to the video. (Sometimes there might be several versions of an item with extra or fewer scenes. This means you need a subtitle track that matches a particular version of the item.)

To include embedded subtitles:

- Set your account [Audio/Subtitle Language preferences](https://support.plex.tv/articles/204985278-account-audio-subtitle-language-settings/)
- Ensure the Local Media Assets source is configured as previously described
- Do a “Refresh All Metadata” for the library, if necessary to recognize the embedded subtitles

**Related Page**: [Account Audio/Subtitle Language Settings](https://support.plex.tv/articles/204985278-account-audio-subtitle-language-settings/)

## External Subtitle Files

There are many internet websites that offer subtitle files. These are “external” subtitle files (i.e. separate from the video file) and are sometimes called “sidecar” subtitle files since they sit next to the regular video.

### Naming External Subtitle Files

Subtitle files need to be named as follows:

#### Movies

- Movie\_Name (Release Date).\[Language\_Code\].ext
- Movies/Movie\_Name (Release Date).\[Language\_Code\].ext

Where `[Language_Code]` is defined by the ISO-639-1 (2-letter) or ISO-639-2/B (3-letter) standard and ext is the file extension. (Some operating systems such as Windows may [hide your file extensions](http://www.thewindowsclub.com/show-file-extensions-in-windows) by default.)

**Related Page**: [ISO-639-1 codes](http://en.wikipedia.org/wiki/List_of_ISO_639-1_codes 'Wikipedia: ISO-639-1 codes') (2-letter)

**Related Page**: [ISO-639-2/B codes](http://en.wikipedia.org/wiki/List_of_ISO_639-2_codes 'Wikipedia: ISO-639-2/B codes') (3-letter)

```text
/Movies
   /Avatar (2009)
      Avatar (2009).mkv
      Avatar (2009).en.srt
```

There are a couple of special flags that you might add to the subtitle filename in special cases:

#### Forced Subtitles

Sometimes, you may have a video where you have subtitles for “foreign” parts. For instance, in Star Wars, Greedo or Jabba the Hutt speak alien languages, so you may see subtitles for those “foreign” parts, even if the rest of the dialog in the movie is in your regular language. Those are “forced” subtitles. By setting a subtitle as “forced”, it allows Plex to try and be smart and to enable it for you, even if the audio is already in your preferred language.

You specify this by adding `forced` to the subtitle filename:

- Movie\_Name (Release Date).\[Language\_Code\].forced.ext
- Movies/Movie\_Name (Release Date).\[Language\_Code\].forced.ext

#### Subtitles for the Deaf and Hard of Hearing (SDH)

In some cases, your subtitles might contain some extra information, such as describing a sound that occurs, like a phone ringing or a “crash” of something falling. Similarly, it might contain information to indicate which character is speaking in some parts. These are “subtitles for the deaf and hard of hearing”, or “SDH” subtitles. Closed Captioning (or “CC”) is also often treated as providing the same type of information.

You can have Plex recognize these by adding `sdh` or `cc` to the subtitle filename:

- Movie\_Name (Release Date).\[Language\_Code\].sdh.ext
- Movies/Movie\_Name (Release Date).\[Language\_Code\].cc.ext

**Note**: Support for SDH/CC subtitles requires Plex Media Server v1.20.3.3401 or newer. It also requires you to be using the [newer Plex Movie metadata agent](https://support.plex.tv/articles/upgrading-a-movie-library-to-the-use-the-new-plex-movie-agent/) and not the older “Plex Movie (Legacy)” agent.

```text
/Movies
   /Avatar (2009)
      Avatar (2009).mkv
      Avatar (2009).eng.srt
      Avatar (2009).en.forced.ass
      Avatar (2009).en.sdh.srt
      Avatar (2009).de.srt
      Avatar (2009).de.sdh.srt
```

#### TV Episodes

- TV Shows/Show\_Name/Season XX/Show\_Name SxxEyy.\[Language\_Code\].ext

Where `[Language_Code]` is defined by the ISO-639-1 (2-letter) or ISO-639-2/B (3-letter) standard.

TV content can also make use of “forced” and “SDH” subtitles, as outlined for movies.

**Related Page**: [ISO-639-1 codes](http://en.wikipedia.org/wiki/List_of_ISO_639-1_codes 'Wikipedia: ISO-639-1 codes') (2-letter)

**Related Page**: [ISO-639-2/B codes](http://en.wikipedia.org/wiki/List_of_ISO_639-2_codes 'Wikipedia: ISO-639-2/B codes') (3-letter)

```text
/TV Shows
   /Absolutely Fabulous
      /Season 02
         Absolutely Fabulous - s02e03.avi
         Absolutely Fabulous - s02e03.eng.smi
         Absolutely Fabulous - s02e03.en.forced.smi
```

### Subtitles Folder

As of server version 1.41.0 using the Plex Series or Plex Movie agents you can put external subtitles in a subtitle directory.

Must in the same parent directory of the video files.

The folder can be named “ **subs**” or “ **subtitles**”

For example, the subtitles folder for episodes in a particular season must be in the season folder that contains the video files.

```text
/TV Shows
   /Absolutely Fabulous
      /Season 01
         Absolutely Fabulous - s01e03.avi
         Absolutely Fabulous - s01e04.avi
         /Subtitles
           Absolutely Fabulous - s01e03.eng.smi
           Absolutely Fabulous - s01e04.eng.srt
      /Season 02
         Absolutely Fabulous - s02e03.avi
         /Subs
           Absolutely Fabulous - s02e03.eng.smi
           Absolutely Fabulous - s02e03.en.forced.smi
```

Share this

Was this article helpful?

[Yes](https://support.plex.tv/articles/200471133-adding-local-subtitles-to-your-media/#vote) [No](https://support.plex.tv/articles/200471133-adding-local-subtitles-to-your-media/#)

1000
You've already provided feedback for this article, thank you for helping us improve our articles.Thank you for helping us improve our articles.Thank you for helping us improve our articles! We'll take it from here.You've already provided feedback for this article, thank you.Looks like you already left that comment.
To vote if this article was helpful, please [sign in](https://www.plex.tv/sign-in/?forward=https://support.plex.tv/articles/200471133-adding-local-subtitles-to-your-media/) with your plex account.

Last modified on: July 1, 2025
