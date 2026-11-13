# Local Media Assets – TV Shows

> Support Articles

The scanners and metadata agents used by Plex will work best when your major types of content are separated from each other. We _strongly_ recommend separating movie and television content into separate main directories. For instance, you might use something like this:

```text
/Media
   /Movies
      movie content
   /Music
      music content
   /TV Shows
      television content
```

**Warning!**: Plex will do its best to appropriately find and match content. However, a failure to separate content such as movies and TV shows may result in unexpected or incorrect behavior.

You might have your own image files for television posters & backgrounds, subtitles, etc. To use these, ensure they are named and organized, and that the Local Media Assets source is enabled and ordered correctly.

## Enable Local Assets Plex TV Series Agent

If using the new **Plex TV Series** agent you only need to enable “Use local Assets” in the libraries settings

**Related:** [Advanced Settings Plex TV Series Agent](https://support.plex.tv/articles/advanced-setting-plex-tv-series-agent/)

## Enable Local Assets (Legacy Agents)

If using the **TheTVDB**, **TheMovieDB** or **Personal Media Shows** agents, “Local Media Assets” is an Agent source that loads local media files or embedded metadata for a series. To do this, ensure the Agent source is enabled and topmost in the list:

- Launch the Plex Web App
- Choose Settings from the top right of the Home screen
- Select your Plex Media Server from the settings sidebar
- Choose Agents
- Choose the Library type and Agent you want to change
- Ensure Local Media Assets is checked
- Ensure Local Media Assets is topmost in the list

**Related Page**: [Metadata Agents](https://support.plex.tv/articles/200241558-agents/)

## Local Artwork Assets

### Supported File Formats

There are a number of supported custom media items that need to be named correctly so they are detected. The supported image file formats are:

- jpg
- jpeg
- png
- tbn

### Poster Artwork

Posters are typically displayed for items on Plex App dashboards, library views, and when looking at details for the series or season. Poster art typically uses a 1:1.5 aspect ratio. Custom posters can be added to either the entire series or an individual season for the series. To do this, name the files as follows:

#### TV Series Posters

To add a custom poster image for the series itself, name the image file as follows:

- /TV Shows/ShowName/Custom\_ShowPoster\_Name.ext

Where `Custom_Poster_Name` can be:

- folder
- poster
- show

…and `ext` is the file extension. (Some operating systems such as Windows may [hide your file extensions](http://www.thewindowsclub.com/show-file-extensions-in-windows) by default.)

```text
/TV Shows
   /Heroes (2006)
      /Season 01
         Heroes (2006) - s01e01 - Genesis.mp4
      show.jpg
```

#### Multiple Series Poster Images

More than one poster image can be included. The poster used can be selected in the Plex Web App. For multiple items to be scanned, they should be named as follows:

- Custom\_ShowPoster\_Name-X.ext

Where `-X` is a number.

```text
/TV Shows
   /Heroes (2006)
      /Season 01
         Heroes (2006) - s01e01 - Genesis.mp4
      show.jpg
      show-2.jpg
      show-3.jpg
```

### Clear Logos

Clear Logos are the show title art that is used in modern Plex clients detail screens. ( there is not a separate one for seasons). The should be put inside the show folder to be picked up for a particular show. PNG files are recommended as they can have a transparent surrounding area ( [alpha channel](https://en.wikipedia.org/wiki/Alpha_compositing)) so that the image or colors behind it can show through.

TV Shows/Show Name (year)/clearlogo.png

- clearlogo.ext
- logo.ext

```text
/TV Shows
   /Heroes (2006)
      clearlogo.png
      /Season 01
         Heroes (2006) - s01e01 - Genesis.mp4
```

#### Multiple Clear Logos

More than one clear logo image can be included. The clear logo used can be selected in the Plex Web App. For multiple items to be scanned, they should be named as follows:

- clearlogo-X.ext
- logo-X.ext

Where `-X` is a number.

```text
/TV Shows
   /Heroes (2006)
      clearlogo.png
      clearlogo-1.png
      clearlogo-2.png
      /Season 01
         Heroes (2006) - s01e01 - Genesis.mp4
```

#### Season Posters

To add a custom poster image for particular Seasons in a show, name the image file as follows:

- /TV Shows/ShowName/Season XX/SeasonXX.ext

Where `XX` is the season number. If you’re specifying the poster for a “Specials” season, use `season-specials-poster` instead.

**Tip!**: Be sure to use the English words “Season” or “Specials” as noted above, even if your content is in another language.

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.avi
         Season01.jpg
```

#### Multiple Poster images

More than one poster image can be included. The poster used can be selected in the Plex Web App. For the multiple items to be scanned, they should be named as follows:

- /TV Shows/ShowName/Season XX/SeasonXXa.ext

Where:

- `XX` is the season number
- `a` is an alphabetic letter (abc) that progresses with the multiple images

**Tip!**: Be sure to use the English word “Season” as noted above, even if your content is in another language.

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.avi
         Season01a.jpg
         Season01b.jpg
         Season01c.jpg
```

### Background (Fanart) Artwork

Background art is often displayed in the background when looking at the details page for a series. It can also be used in the background elsewhere or for a slideshow or screensaver. Background art typically uses a 16:9 aspect ratio. Local background artwork or “fanart” can be added as follows:

- /TV Shows/ShowName/Custom\_Fanart\_Name.ext

Where `Custom_Fanart_Name` can be one of the following:

- art
- backdrop
- background
- fanart

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.mp4
      fanart.jpg
```

#### Multiple Background (Fanart) images

More than one Fanart image can be included. The Fanart image used can be selected in the Plex Web App. For multiple items to be scanned, they should be named as follows:

- Custom\_Fanart\_Name-X.ext

Where `-X` is a number.

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.mkv
      fanart-1.jpg
      fanart-2.png
```

### Square Art

Square art is the background image used on the details screens of shows on the iOS and Android mobile apps.

- /TV Shows/ShowName/Custom\_SquareArt\_Name.ext

Where `Custom_SquareArt_Name` can be:

- square.ext
- squareArt.ext
- backgroundSquare.ext

```text
/TV Shows
   /Heroes (2006)
      backgroundSquare.jpg
      /Season 01
         Heroes (2006) - s01e01 - Genesis.mp4
```

### Banner Artwork

Banner art is not used by many Plex Apps. When they are, they’re wide, short images and often used as the header of a page. Banner art typically uses a 5.4:1 aspect ratio. Custom banners can be added for either the entire Show or a show’s individual Seasons. To do this, name the files as follows:

#### Show Banners

To specify a banner to use for the show, name the image file as follows:

- /TV Shows/ShowName/banner.ext

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.mp4
      banner.jpg
```

#### Multiple Banner images

More than one banner image can be included. The banner image used can be selected in the Plex Web App. For multiple items to be scanned, they should be named as follows:

- /TV Shows/ShowName/banner-X.ext

Where `-X` is a number

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.avi
      banner-1.jpg
      banner-2.png
```

#### Season Banners

To specify a banner to use for a particular season, name the image file as follows:

- /TV Shows/ShowName/SeasonXX/seasonXX-banner.ext

If you’re specifying the banner for a “Specials” season, use `season-specials-banner` instead.

**Tip!**: Be sure to use the English words “Season” or “Specials” as noted above, even if your content is in another language.

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.avi
         Season01-banner.jpg
```

#### Multiple Season Banner images

More than one banner image can be included. The banner image used can be selected in the Plex Web Appr. For multiple items to be scanned, they should be named as follows:

- /TV Shows/ShowName/SeasonXX/seasonXX-banner(abc).ext

Where:

- `XX` is the season number
- `a` is an alphabetic letter (abc) that progresses with the multiple images

**Tip!**: Be sure to use the English word “Season” as noted above, even if your content is in another language.

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.mkv
         Season01-bannera.jpg
         Season01-bannerb.png
         Season01-bannerc.jpg
```

### Episode Artwork

Each episode can have its own artwork. Typically, this will be a representative screenshot from the actual episode itself. These are usually displayed on the details page for an episode. As episode art typically comes from the episode itself, it will usually be either 4:3 or 16:9 aspect ratio. The artwork to display for an episode can be specified using an image file named identically to the episode file and placed alongside it:

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.mp4
         Heroes - s01e01 - Genesis.jpg
```

## Local Theme Songs

Many Plex Apps can play the theme song for a series when viewing that series in your library if a theme song is available. You may use your own MP3 file for the show theme song. To do so, simply place a “theme.mp3” audio file inside the main show directory:

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.avi
      theme.mp3
```

**Related Page**: [TV Theme Music & Submissions](https://support.plex.tv/articles/201572843-tv-theme-music-submissions/)

## External Subtitle Files

### Supported Subtitle Formats

The following formats are fully supported as external subtitle files. Full support means they are compatible with all Plex Apps, including clients that require transcoded media.

- SRT
- SMI
- SSA (or ASS)

**Related Pages**: [Transcoding Media](https://support.plex.tv/articles/200250377-transcoding-media/)

### Naming External Subtitle Files

Subtitle files need to be named as follows:

- TV Shows/ShowName/Season XX/ShowName SxxEyy.\[Language\_Code\].ext

Where `[Language_Code]` is defined by the ISO-639-1 (2-letter) or ISO-639-2/B (3-letter) standard.

**Related Page**: [ISO-639-1 codes](http://en.wikipedia.org/wiki/List_of_ISO_639-1_codes 'Wikipedia: ISO-639-1 codes') (2-letter)

**Related Page**: [ISO-639-2/B codes](http://en.wikipedia.org/wiki/List_of_ISO_639-2_codes 'Wikipedia: ISO-639-2/B codes') (3-letter)

```text
/TV Shows
   /Absolutely Fabulous
      /Season 2
         Absolutely Fabulous - s02e03.mkv
         Absolutely Fabulous - s02e03.eng.smi
```

## Full Example for Local Television Metadata Files

Below is an example of extensive use of the various local files you can specify for television sections:

```text
/TV Shows
   /Heroes
      /Season 01
         Heroes - s01e01 - Genesis.avi
         Heroes - s01e01 - Genesis.jpg
         Heroes - s01e02 - Don't Look Back.mp4
         Season01.jpg
         Season01b.png
      /Season 2
         Heroes - s02e01 - Four Months Later.mkv
         Heroes - s02e02 - Lizards.mkv
         Heroes - s02e03 - Kindred.avi
         Season02-bannera.tbn
         Season02-bannerb.jpeg
      art.png
      background-1.jpg
      background-2.tbn
      banner.jpg
      show-1.jpg
      show-2.png
      theme.mp3
```
