import path from 'node:path';

import { describe, expect, it } from 'vite-plus/test';

import {
  extractPlexTags,
  extractSplitPart,
  formatEditionTag,
  formatMovieRelativePath,
  formatTvRelativePath,
  parseProviderReference,
  resolveContainedOutputPath,
  sanitizePlexSegment
} from '../../src/domain/plexFormatter.ts';
import {
  asClientId,
  asImdbId,
  asIso639_2Code,
  asItemId,
  asJobId,
  asTmdbId,
  asTvdbId,
  type MediaProbeSummary
} from '../../src/domain/types.ts';

const SAMPLE_4K_HDR_PROBE: MediaProbeSummary = {
  formatName: 'matroska,webm',
  durationSeconds: 7200,
  sizeBytes: 10_000_000_000,
  bitrateBps: 11_000_000,
  videoStreams: [
    {
      index: 0,
      codecName: 'hevc',
      width: 3840,
      height: 2160,
      bitDepth: 10,
      colorTransfer: 'smpte2084'
    }
  ],
  audioStreams: [
    {
      index: 1,
      streamOrder: 0,
      codecName: 'eac3',
      language: asIso639_2Code('eng'),
      channels: 6,
      isDefault: true
    }
  ],
  subtitleStreams: []
};

describe('plexFormatter', () => {
  it('sanitizes ampersands, exclamation marks, trailing dots, reserved names, and validates FS safety', () => {
    expect(sanitizePlexSegment('Fast & Furious: Tokyo? <Drift> / 1*')).toBe(
      'Fast and Furious Tokyo Drift 1'
    );
    expect(sanitizePlexSegment('Student Organization! / Episode... ')).toBe(
      'Student Organization! Episode'
    );
    expect(sanitizePlexSegment('CON')).toBe('_CON');
  });

  it('extracts deterministic tags from filename and probe metadata', () => {
    expect(extractPlexTags('Blade.Runner.1982.Directors.Cut.2160p.Latino.HDR.10bit.mkv')).toEqual([
      '4k',
      'Directors Cut',
      'Spanish Audio',
      'HDR',
      '10bit'
    ]);

    expect(extractPlexTags('Movie.Extended.Unrated.1440p.mkv')).toEqual([
      '2k',
      'Extended',
      'Unrated'
    ]);

    expect(extractPlexTags('Movie.mkv', SAMPLE_4K_HDR_PROBE)).toEqual(['4k', 'HDR', '10bit']);
    expect(
      extractPlexTags('Movie.mkv', {
        ...SAMPLE_4K_HDR_PROBE,
        videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }]
      })
    ).toEqual(['1080p']);
    expect(
      extractPlexTags('Movie.mkv', {
        ...SAMPLE_4K_HDR_PROBE,
        videoStreams: [
          {
            index: 0,
            codecName: 'hevc',
            width: 2560,
            height: 1440,
            colorTransfer: 'arib-std-b67'
          }
        ]
      })
    ).toEqual(['2k', 'HDR']);
    expect(
      extractPlexTags('Movie.mkv', {
        ...SAMPLE_4K_HDR_PROBE,
        videoStreams: [{ index: 0, codecName: 'h264', width: 1280, height: 720 }]
      })
    ).toEqual(['720p']);
    expect(
      extractPlexTags('Movie.mkv', {
        ...SAMPLE_4K_HDR_PROBE,
        videoStreams: [{ index: 0, codecName: 'h264', width: 720, height: 480 }]
      })
    ).toEqual(['480p']);
  });

  it('validates branded ID helpers', () => {
    expect(asJobId('job-1')).toBe('job-1');
    expect(asItemId('item-1')).toBe('item-1');
    expect(asClientId('b1:t1')).toBe('b1:t1');
    expect(() => asIso639_2Code('invalid')).toThrow('Invalid ISO 639-2 code');
  });

  it('extracts valid split parts up to 8 and ignores invalid numbers', () => {
    expect(extractSplitPart('The Dark Knight (2008) - pt1')).toBe('pt1');
    expect(extractSplitPart('Episode s01e01 cd2')).toBe('cd2');
    expect(extractSplitPart('Movie part9')).toBeUndefined();
  });

  it('enforces 32-character limit on Plex edition tags', () => {
    expect(formatEditionTag("Director's Cut")).toBe("{edition-Director's Cut}");
    const longEdition = 'A'.repeat(40);
    expect(formatEditionTag(longEdition)).toBe(`{edition-${'A'.repeat(32)}}`);
    expect(formatEditionTag('   ')).toBeUndefined();
  });

  it('formats movie relative paths with imdb/tmdb, edition, tags, and split part', () => {
    expect(
      formatMovieRelativePath({
        title: '1917',
        year: 2019,
        imdbId: asImdbId('tt8579674'),
        tags: ['4k', '10bit']
      })
    ).toBe(
      path.join(
        '1917 (2019) {imdb-tt8579674} [4k, 10bit]',
        '1917 (2019) {imdb-tt8579674} [4k, 10bit].mkv'
      )
    );

    expect(
      formatMovieRelativePath({
        title: 'Blade Runner',
        year: 1982,
        tmdbId: asTmdbId('78'),
        edition: 'Final Cut',
        splitPart: 'pt1'
      })
    ).toBe(
      path.join(
        'Blade Runner (1982) {tmdb-78} {edition-Final Cut}',
        'Blade Runner (1982) {tmdb-78} {edition-Final Cut} - pt1.mkv'
      )
    );
  });

  it('formats TV show relative paths for standard, specials, multi-episode, and date-based', () => {
    expect(
      formatTvRelativePath({
        showTitle: 'Fallout',
        year: 2024,
        tvdbId: asTvdbId('416744'),
        episode: {
          seasonNumber: 1,
          episodeStart: 1,
          episodeTitle: 'The End'
        }
      })
    ).toBe(
      path.join(
        'Fallout (2024) {tvdb-416744}',
        'Season 01',
        'Fallout (2024) - s01e01 - The End.mkv'
      )
    );

    expect(
      formatTvRelativePath({
        showTitle: 'Breaking Bad',
        year: 2008,
        tvdbId: asTvdbId('81189'),
        edition: 'Bluray Remaster',
        episode: {
          seasonNumber: 1,
          episodeStart: 1,
          episodeEnd: 2,
          episodeTitle: 'Pilot',
          splitPart: 'pt1'
        }
      })
    ).toBe(
      path.join(
        'Breaking Bad (2008) {tvdb-81189} {edition-Bluray Remaster}',
        'Season 01',
        'Breaking Bad (2008) - s01e01-e02 - Pilot - pt1.mkv'
      )
    );

    expect(
      formatTvRelativePath({
        showTitle: 'The Daily Show',
        year: 1996,
        episode: {
          seasonNumber: 0,
          episodeStart: 1,
          airDate: '2024-10-07'
        }
      })
    ).toBe(
      path.join('The Daily Show (1996)', 'Season 00', 'The Daily Show (1996) - 2024-10-07.mkv')
    );

    const longFormatted = formatTvRelativePath({
      showTitle: 'There Is Also a Hole in the Student Organization',
      year: 2026,
      tvdbId: asTvdbId('463051'),
      episode: {
        seasonNumber: 1,
        episodeStart: 1,
        episodeTitle:
          'Even High School Boys Have Their Holes... Ume Takes Responsibility And A Very Long Subtitle That Exceeds Windows Path Limits Easily'
      }
    });
    expect(longFormatted.length).toBeLessThanOrEqual(180);
    expect(longFormatted).not.toContain('..');
    expect(longFormatted).toContain(
      'There Is Also a Hole in the Student Organization (2026) - s01e01'
    );

    // Extremely long show title leaves < 12 chars for episode title -> omits episode title cleanly
    const ultraLongShow = 'A'.repeat(90);
    const omittedTitlePath = formatTvRelativePath({
      showTitle: ultraLongShow,
      year: 2026,
      episode: {
        seasonNumber: 1,
        episodeStart: 1,
        episodeTitle: 'Some Episode Title'
      }
    });
    expect(omittedTitlePath).not.toContain('Some Episode Title');

    // Empty/punctuation-only episode title -> omitted cleanly
    const emptyTitlePath = formatTvRelativePath({
      showTitle: 'Fallout',
      year: 2024,
      episode: { seasonNumber: 1, episodeStart: 1, episodeTitle: '///' }
    });
    expect(emptyTitlePath).toBe(
      path.join('Fallout (2024)', 'Season 01', 'Fallout (2024) - s01e01.mkv')
    );
  });

  it('enforces strict root containment in resolveContainedOutputPath', () => {
    const root = path.resolve('/data/output/movies');
    const valid = resolveContainedOutputPath(root, path.join('1917 (2019)', '1917 (2019).mkv'));
    expect(valid).toBe(path.join(root, '1917 (2019)', '1917 (2019).mkv'));

    expect(() => resolveContainedOutputPath(root, '../../etc/passwd')).toThrow(
      'Path traversal rejected'
    );
  });

  it('extracts IMDb, TVDB, and TVmaze IDs from URLs and tags', () => {
    expect(parseProviderReference('https://www.imdb.com/title/tt0816692/?ref_=fn_al_tt_1')).toEqual(
      { imdbId: asImdbId('tt0816692') }
    );
    expect(parseProviderReference('https://www.tvmaze.com/shows/1234/fallout')).toEqual({
      tvmazeId: 1234
    });
    expect(parseProviderReference('https://thetvdb.com/?tab=series&id=81931')).toEqual({
      tvdbId: asTvdbId('81931')
    });
    expect(parseProviderReference('{tvdb-393077}')).toEqual({
      tvdbId: asTvdbId('393077')
    });
    expect(parseProviderReference('Batman Beyond')).toEqual({});
  });
});
