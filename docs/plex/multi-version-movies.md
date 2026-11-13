# Multi-Version Movies

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

## Multiple Versions of the Same Movie

You can gather multiple versions of the same movie together (that have different resolutions or encoding formats) and collapse them to a single item. For example, you can have 3 versions: ones suitable for a mobile phone, a tablet, and a 1080p TV. The multiple versions will be collapsed to a single item in the library. When a Plex app goes to play the collapsed item, it will automatically request and play the most suitable item by default. Many apps will also allow you to select a Play Version action, where you can choose which version to play.

**Note**: Not all Plex apps will allow you to manually choose which version to play. You should not rely on a choice being presented.

To merge the files, name them:

- `MovieName (Release Year) - ArbitraryText.ext`

Where ext is the file extension. (Some operating systems such as Windows may [hide your file extensions](http://www.thewindowsclub.com/show-file-extensions-in-windows) by default.) `ArbitraryText` can be any text useful to you to identify the media from outside Plex. Plex will show you the actual resolution of the media if the app you’re using shows you a list or use the best file for a mobile app. The text you have there is _not_ displayed.

```text
/Movies
   /Pulp Fiction (1994)
      Pulp Fiction (1994) - 1080p.mkv
      Pulp Fiction (1994) - SD.m4v
```

## Frequently Asked Questions

### What’s the difference between “Editions” and “Versions”?

Versions all represent the same release of an item. So, you can have multiple versions (1080p vs 480p, HEVC vs H.264, MP4 vs MKV) of [_The Empire Strikes Back_](https://watch.plex.tv/movie/star-wars-episode-v-the-empire-strikes-back), but they’re all for the same theatrical release of the movie.

Editions represent different releases of an item. So, the “theatrical release” vs the “Special Edition” of _The Empire Strikes Back_. Or “Theatrical” vs “Director’s Cut” vs “Final Cut” of [_Blade Runner_](https://watch.plex.tv/movie/blade-runner-1982). Editions would also be appropriate for a 2D vs 3D version of a movie.

### Can I use Editions and Versions at the same time?

Absolutely. You’ll need to make sure that each of the versions of the edition have the appropriate file naming to specify that edition. You’ll want to make sure that you use the file naming method and not just edit the movie information in the web app. Example:

```text
/Media
   /Movies
      /Blade Runner (1982)
         Blade Runner (1982).mp4
      /Blade Runner (1982) {edition-Director's Cut}
         Blade Runner (1982).1080p.h264 {edition-Director's Cut}.mp4
         Blade Runner (1982).1080p.hevc {edition-Director's Cut}.mkv
         Blade Runner (1982).4k.h264 {edition-Director's Cut}.mp4
         Blade Runner (1982).4k.hevc {edition-Director's Cut}.mkv
```

In the above example, there are two different editions of _Blade Runner_, the original release and then a “Director’s Cut” edition. The “Director’s Cut” has four different versions available: H.264 and HEVC encodings at both 1080p and 4K resolutions.
