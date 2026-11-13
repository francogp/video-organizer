# Multiple Editions – Movies

> Support Articles

**Tip!**: The ability to specify different editions for a movie requires a [Plex Pass](https://www.plex.tv/plex-pass/) subscription for Server admin account.

Currently, Plex’s [multi-version support](https://support.plex.tv/articles/200381043-multi-version-movies/) has allowed users to provide multiple different versions of the same underlying movie/episode and have them merged together. This is for cases where you have versions that are different resolutions (e.g. 1080p and 4K) or encodings (e.g. H.264 vs HEVC). The feature is also used as part of the server’s [Media Optimizer](https://support.plex.tv/articles/214079318-media-optimizer-overview/) feature.

That feature allows player apps to either automatically choose the appropriate version to play or else offer the user a choice, since the versions should all represent the same underlying movie or episode. It’s the same actual content, just a different resolution/encoding/etc.

**Related Page**: [Multi-Version Movies](https://support.plex.tv/articles/200381043-multi-version-movies/)

**Related Page**: [Media Optimizer Overview](https://support.plex.tv/articles/214079318-media-optimizer-overview/)

Sometimes, however, you might have a movie that has multiple different “cuts”: Theatrical release, Director’s Cut, Extended Edition, Unrated, etc. _[Blade Runner](https://watch.plex.tv/movie/blade-runner-1982)_ is famous for having [multiple different cuts](https://en.wikipedia.org/wiki/Versions_of_Blade_Runner) released for users to watch. The original Star Wars trilogy is similarly famous for having both the original (theatrical) versions and then the later “Special Editions” (not to mention other fan-produced cuts). This is where Plex’s support for “Editions” comes into play.

When you have a non-standard edition of a movie, you can specify which particular edition it is. In cases where you have multiple editions of the same movie, they can all be added to your library, where their watched status, user ratings, etc. are all tracked separately.

## Viewing and Accessing Editions

Currently, all editions of a movie you’ve added to your server will be displayed in the library grid when viewing the library. As such, most users will prefer to edit each library item to choose or provide an appropriate poster, to help differentiate them.

![Plex Media Server example](https://support.plex.tv/wp-content/uploads/sites/4/2022/08/Plex-29.png)

When viewing the details page for a movie edition, a tag will be displayed with that edition name.

![Plex Media Server example](https://support.plex.tv/wp-content/uploads/sites/4/2022/08/Plex-30.png)

In addition, if you have multiple editions of the same movie in the library, the details page will have a “Other Editions of \[movie\]” section, allowing quick access to any of the other editions of that same movie available in the library.

![Plex Media Server example](https://support.plex.tv/wp-content/uploads/sites/4/2022/08/Plex-31.png)

## Specifying Edition Information

You can specify or add edition information in a couple of different ways.

### Name the File Appropriately

Anyone running a Plex Media Server can specify an edition for a movie simply by naming the video file correctly, when adding it to the library. Specifically, some special text needs to be added to the end of the filename. For example:

```text
/Media
   /Movies
      Blade Runner (1982) {edition-Director's Cut}.mp4
      Blade Runner (1982) {edition-Final Cut}.mp4
```

Refer to our dedicated naming and organizing article for specific details on how to name the files and/or folders to specify different editions. If you have local trailers or extras for any of your “multiple edition” movies, you should also review our information about those local trailers and extras.

**Note**: If you rename the file for an existing library item, it will be treated as a new library item after the next scan. Any watched status or customization of the metadata you had previously done for this movie will not carry over to this new “Edition”. To maintain the existing title information, we recommend you instead use the “Edit” method outlined below.

**Related Page**: [Naming and organizing your Movie files](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/)

**Related Page**: [Local Files for Movie Trailers and Extras](https://support.plex.tv/articles/local-files-for-trailers-and-extras/)

### Edit the Library Item

For those who don’t want to mess with file naming, you can also specify edition information for existing library items when editing details for the movie.

Support for editing the edition information is available in the Plex Web app, version 4.87.1 or newer.

![The edit dialog in the web app for the movie Blade Runner, showing the 'Edition' field being available and set to the value of 'Final Cut'.](https://support.plex.tv/wp-content/uploads/sites/4/2022/08/EditModal.png)

If you add or edit the Edition tag from this Edit page, the existing library item will be converted to the specified Edition. Any watched status or customization of the metadata you had previously made for this movie will carry over to this new “Edition”.

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

### Can I use local trailers or extras with Editions?

Yes, trailers and extras are supported, but you need to organize editions using the “folder” method. See our articles about naming as well as using local trailers and extras for more information.

**Related Page**: [Naming and organizing your Movie files](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/)

**Related Page**: [Local Files for Movie Trailers and Extras](https://support.plex.tv/articles/local-files-for-trailers-and-extras/)

### Do Multiple Editions work with watch state syncing?

If you’ve enabled syncing of watch state and ratings, that does not currently work with “editions” of movies. Any regular, non-edition movie in your library can sync its watch state or rating, but if you’ve added “edition” information to the item, that item will not be included in syncing. (Doing so would indicate that the activity definitely came from a personal Plex Media Server, since “editions” aren’t available elsewhere.)

**Related Page**: [Sync Watch State and Ratings](https://support.plex.tv/articles/sync-watch-state-and-ratings/)

### What happens if my Plex Pass subscription expires?

Nothing will happen to your library. However, you will not be able to add edition information to new content or change the information on any existing Editions.

### Can I add Editions for TV Shows or Episodes?

There is not support for Editions of TV Shows or Episodes at this time

Share this

Was this article helpful?

[Yes](https://support.plex.tv/articles/multiple-editions/#vote) [No](https://support.plex.tv/articles/multiple-editions/#)

1000
You've already provided feedback for this article, thank you for helping us improve our articles.Thank you for helping us improve our articles.Thank you for helping us improve our articles! We'll take it from here.You've already provided feedback for this article, thank you.Looks like you already left that comment.
To vote if this article was helpful, please [sign in](https://www.plex.tv/sign-in/?forward=https://support.plex.tv/articles/multiple-editions/) with your plex account.

Last modified on: July 7, 2026
