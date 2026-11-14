import { describe, expect, it } from 'vite-plus/test';

import {
  buildMovieVerificationEntry,
  buildTvVerificationEntry,
  parseLibraryRootName
} from '../../src/domain/libraryVerifier.ts';
import { asImdbId, asTvdbId } from '../../src/domain/types.ts';

describe('libraryVerifier domain', () => {
  it('parses root folder names with Plex tags, year, edition, and brackets', () => {
    const parsed = parseLibraryRootName(
      'Blade Runner (1982) {imdb-tt0083658} {edition-Final Cut} [1080p, x265]'
    );
    expect(parsed.cleanTitle).toBe('Blade Runner');
    expect(parsed.year).toBe(1982);
    expect(parsed.imdbId).toBe(asImdbId('tt0083658'));
    expect(parsed.edition).toBe('Final Cut');
    expect(parsed.bracketTags).toEqual(['1080p', 'x265']);
  });

  it('returns null for a strictly compliant TV show', () => {
    const episodeTitles = new Map([['1:1', 'The End']]);
    const entry = buildTvVerificationEntry({
      category: 'tv-shows',
      currentRootName: 'Fallout (2024) {tvdb-416744}',
      resolvedTitle: 'Fallout',
      resolvedYear: 2024,
      tvdbId: asTvdbId('416744'),
      episodeTitles,
      seasonDirs: [
        {
          dirName: 'Season 01',
          files: [
            'Fallout (2024) - s01e01 - The End.mkv',
            'Fallout (2024) - s01e01 - The End.en.srt'
          ]
        }
      ]
    });
    expect(entry).toBeNull();
  });

  it('builds bottom-up rename steps for a non-compliant TV show (file -> season-dir -> root-dir)', () => {
    const episodeTitles = new Map([['1:1', 'The End']]);
    const entry = buildTvVerificationEntry({
      category: 'tv-shows',
      currentRootName: 'Fallout {tvdb-416744}',
      resolvedTitle: 'Fallout',
      resolvedYear: 2024,
      tvdbId: asTvdbId('416744'),
      episodeTitles,
      seasonDirs: [
        {
          dirName: 'season 1',
          files: ['Fallout.S01E01.mkv', 'Fallout.S01E01.es.srt']
        }
      ]
    });
    expect(entry).not.toBeNull();
    expect(entry?.issues).toContain('MISSING_YEAR');
    expect(entry?.issues).toContain('NON_STANDARD_SEASON_DIR');
    expect(entry?.issues).toContain('NON_STANDARD_FILENAME');
    expect(entry?.issues).not.toContain('SUBTITLE_STEM_MISMATCH');

    const kinds = entry?.steps.map((s) => s.kind);
    expect(kinds).toEqual(['file', 'file', 'season-dir', 'root-dir']);
    expect(entry?.steps[0]).toEqual({
      kind: 'file',
      fromRelative: 'Fallout {tvdb-416744}/season 1/Fallout.S01E01.mkv',
      toRelative: 'Fallout {tvdb-416744}/season 1/Fallout (2024) - s01e01 - The End.mkv'
    });
    expect(entry?.steps[2]).toEqual({
      kind: 'season-dir',
      fromRelative: 'Fallout {tvdb-416744}/season 1',
      toRelative: 'Fallout {tvdb-416744}/Season 01'
    });
    expect(entry?.steps[3]).toEqual({
      kind: 'root-dir',
      fromRelative: 'Fallout {tvdb-416744}',
      toRelative: 'Fallout (2024) {tvdb-416744}'
    });
  });

  it('builds bottom-up rename steps for a non-compliant movie (file -> root-dir)', () => {
    const entry = buildMovieVerificationEntry({
      category: 'movies',
      currentRootName: 'Dune {imdb-tt1160419}',
      resolvedTitle: 'Dune',
      resolvedYear: 2021,
      imdbId: asImdbId('tt1160419'),
      files: ['dune.mkv', 'dune.en.srt']
    });
    expect(entry).not.toBeNull();
    expect(entry?.issues).toContain('MISSING_YEAR');
    expect(entry?.issues).toContain('NON_STANDARD_FILENAME');
    expect(entry?.issues).not.toContain('SUBTITLE_STEM_MISMATCH');
    expect(entry?.steps.map((s) => s.kind)).toEqual(['file', 'file', 'root-dir']);
    expect(entry?.expectedRootName).toBe('Dune (2021) {imdb-tt1160419}');
  });

  it('returns null for a strictly compliant movie', () => {
    const entry = buildMovieVerificationEntry({
      category: 'movies',
      currentRootName: 'Dune (2021) {imdb-tt1160419}',
      resolvedTitle: 'Dune',
      resolvedYear: 2021,
      imdbId: asImdbId('tt1160419'),
      files: ['Dune (2021) {imdb-tt1160419}.mkv', 'Dune (2021) {imdb-tt1160419}.en.srt']
    });
    expect(entry).toBeNull();
  });

  it('handles unresolved metadata, missing provider id, edition, specials, and invalid episodes', () => {
    const tvEntry = buildTvVerificationEntry({
      category: 'animated-series',
      currentRootName: 'Mystery Show',
      resolvedTitle: 'Mystery Show',
      edition: 'Uncut',
      unresolvedMetadata: true,
      seasonDirs: [
        {
          dirName: 'Specials',
          files: ['readme.txt', 'no-episode-number.mkv', 'Mystery.S00E01-part1.mkv']
        }
      ]
    });
    expect(tvEntry?.issues).toContain('UNRESOLVED_METADATA');
    expect(tvEntry?.issues).toContain('MISSING_PROVIDER_ID');
    expect(tvEntry?.expectedRootName).toContain('{edition-Uncut}');

    const movieEntry = buildMovieVerificationEntry({
      category: 'movies',
      currentRootName: 'Unknown Doc [1080p]',
      resolvedTitle: 'Unknown Doc',
      unresolvedMetadata: true,
      files: ['Unknown Doc [1080p].mkv']
    });
    expect(movieEntry?.issues).toContain('UNRESOLVED_METADATA');
    expect(movieEntry?.issues).toContain('MISSING_PROVIDER_ID');
  });

  it('strips trailing video extensions from movie folder names without polluting cleanTitle', () => {
    const parsed = parseLibraryRootName('Elysium (2013) {imdb-tt1535108} [4k, HDR, 10bit].mkv');
    expect(parsed.cleanTitle).toBe('Elysium');
    expect(parsed.year).toBe(2013);
    expect(parsed.imdbId).toBe(asImdbId('tt1535108'));
    expect(parsed.bracketTags).toEqual(['4k', 'HDR', '10bit']);

    const entry = buildMovieVerificationEntry({
      category: 'movies',
      currentRootName: 'Elysium (2013) {imdb-tt1535108} [4k, HDR, 10bit].mkv',
      resolvedTitle: parsed.cleanTitle,
      resolvedYear: parsed.year,
      imdbId: parsed.imdbId,
      files: ['Elysium (2013) {imdb-tt1535108} [4k, HDR, 10bit].mkv']
    });
    expect(entry?.expectedRootName).toBe('Elysium (2013) {imdb-tt1535108} [4k, HDR, 10bit]');
    expect(entry?.steps).toEqual([
      {
        kind: 'root-dir',
        fromRelative: 'Elysium (2013) {imdb-tt1535108} [4k, HDR, 10bit].mkv',
        toRelative: 'Elysium (2013) {imdb-tt1535108} [4k, HDR, 10bit]'
      }
    ]);
  });

  it('preserves leading bracketed titles like [REC] and ignores Part 1/2 inside movie titles', () => {
    const rec2 = parseLibraryRootName('[REC] 2 (2009) {imdb-tt1245112} [1080p]');
    expect(rec2.cleanTitle).toBe('[REC] 2');
    expect(rec2.year).toBe(2009);
    expect(rec2.bracketTags).toEqual(['1080p']);

    const rec3 = parseLibraryRootName('[REC] 3 Genesis (2012) {imdb-tt1649444} [1080p]');
    expect(rec3.cleanTitle).toBe('[REC] 3 Genesis');
    expect(rec3.year).toBe(2012);
    expect(rec3.bracketTags).toEqual(['1080p']);

    expect(
      buildMovieVerificationEntry({
        category: 'movies',
        currentRootName: '[REC] 2 (2009) {imdb-tt1245112} [1080p]',
        resolvedTitle: rec2.cleanTitle,
        resolvedYear: rec2.year,
        imdbId: rec2.imdbId,
        files: [
          '[REC] 2 (2009) {imdb-tt1245112} [1080p].mkv',
          '[REC] 2 (2009) {imdb-tt1245112} [1080p].spa.srt'
        ]
      })
    ).toBeNull();

    expect(
      buildMovieVerificationEntry({
        category: 'movies',
        currentRootName:
          'Harry Potter and the Deathly Hallows Part 1 (2010) {imdb-tt0926084} [1080p]',
        resolvedTitle: 'Harry Potter and the Deathly Hallows Part 1',
        resolvedYear: 2010,
        imdbId: asImdbId('tt0926084'),
        files: [
          'Harry Potter and the Deathly Hallows Part 1 (2010) {imdb-tt0926084} [1080p].mkv',
          'Harry Potter and the Deathly Hallows Part 1 (2010) {imdb-tt0926084} [1080p].spa.srt'
        ]
      })
    ).toBeNull();
  });
});
