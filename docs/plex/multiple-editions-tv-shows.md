# Multiple Editions – TV Shows

> Support Articles

**Tip!**: The ability to specify different editions for a movie requires a [Plex Pass](https://www.plex.tv/plex-pass/) subscription for Server admin account.

Currently, Plex’s multi-version support has allowed users to provide multiple different versions of the same underlying movie/episode and have them merged together. This is for cases where you have versions that are different resolutions (e.g. 1080p and 4K) or encodings (e.g. H.264 vs HEVC). The feature is also used as part of the server’s [Media Optimizer](https://support.plex.tv/articles/214079318-media-optimizer-overview/) feature.

That feature allows player apps to either automatically choose the appropriate version to play or else offer the user a choice, since the versions should all represent the same underlying movie or episode. It’s the same actual content, just a different resolution/encoding/etc.

**Related Page**: [Media Optimizer Overview](https://support.plex.tv/articles/214079318-media-optimizer-overview/)

Sometimes, however, you might have copies of a TV show that are different like a movie might have multiple “cuts”. The Wire was originally a 4:3 aspect ratio then re-released in 16:9. Fans of anime may have a dubbed and original language as separate files. You may just want more than one episode order for a show to be available as separate listings. This is where Plex’s support for “Editions” comes into play.

When you have a non-standard edition of a tv show you can specify which particular edition it is. In cases where you have multiple editions of the same TV show, they can all be added to your library, where their watched status, user ratings, etc. are all tracked separately.

Note that this feature is for editions of a show as a whole. It is not for editions of individual seasons or episodes.

## Client support

Edition display is live now in Plex Web (4.160) and rolling out in the iOS and Android apps (version 2026.13.0). Roku support is coming in the next release.

In clients that do not support the feature yet, the edition information will not appear but they will be separate listings. It is recommended to select different show posters to tell them apart.

## Viewing and Accessing Editions

All editions of a TV Show you’ve added to your server will be displayed in the library grid when viewing the library. As such, most users will prefer to edit each library item to choose or provide an appropriate poster, to help differentiate them.

![Plex Media Server example](https://support.plex.tv/wp-content/uploads/sites/4/2026/07/Plex-1.jpg)

When viewing the details page for a tv show edition, a tag will be displayed with that edition name.

![Plex Media Server example](https://support.plex.tv/wp-content/uploads/sites/4/2026/07/Screenshot_20260709-074520.jpg)

## Specifying Edition Information

You can specify or add edition information in a couple of different ways.

### Name the File Appropriately

Anyone running a Plex Media Server can specify an edition for a movie simply by naming the main show folder correctly, when adding it to the library. Specifically, some special text needs to be added to the end of the folder name in curly brackets `{edition-Edition Title}`. For example:

```text
/Media
   /TV Shows
      /Babylon 5 (1994)
          /Season 01
      /Babylon 5 (1994) {edition-Bluray Remaster}
          /Season 01
```

**Note**: If you rename the folder for an existing library item, it will be treated as a new library item after the next scan. Any watched status or customization of the metadata you had previously done for this movie will not carry over to this new “Edition”. To maintain the existing title information, we recommend you instead use the “Edit” method outlined below.

**Related Page**: [Naming and Organizing Your TV Show Files](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/)

### Edit the Library Item

For those who don’t want to mess with file naming, you can also specify edition information for existing library items when editing details for the movie.

Support for editing the edition information is available in the Plex Web app, version 4.160 or newer.

![Plex Media Server example](https://support.plex.tv/wp-content/uploads/sites/4/2026/07/Plex.jpg)

If you add or edit the Edition tag from this Edit page, the existing library item will be converted to the specified Edition. Any watched status or customization of the metadata you had previously made for this movie will carry over to this new “Edition”.

## Frequently Asked Questions

### What’s the difference between “Editions” and “Versions”?

For TV Shows versions represent the same release of episodes but you can have multiple versions (1080p vs 480p, HEVC vs H.264, MP4 vs MKV) codec or quality wise for those episodes

Editions in Plex represent different releases of TV Show as a whole. So, the “color” vs the “black and white” of _Spider Noir_. Or “Blur Ray” vs “DVD” editions of _Babylon 5_ where there are different episode counts/orders.

### Do Multiple Editions work with watch state syncing?

If you’ve enabled syncing of watch state and ratings, that does not currently work with “editions” of tv shows. Any regular, non-edition show in your library can sync its watch state or rating, but if you’ve added “edition” information to the item, that item will not be included in syncing. (Doing so would indicate that the activity definitely came from a personal Plex Media Server, since “editions” aren’t available elsewhere.)

**Related Page**: [Sync Watch State and Ratings](https://support.plex.tv/articles/sync-watch-state-and-ratings/)

### What happens if my Plex Pass subscription expires?

Nothing will happen to your library. However, you will not be able to add edition information to new content or change the information on any existing Editions.

### Can I add Editions for specific Episodes?

There is not support for Editions of Episodes at this time
