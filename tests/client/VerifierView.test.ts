// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';

import VerifierView from '../../src/client/components/VerifierView.vue';
import {
  asVerifierEntryId,
  type VerifierEntry,
  type VerifierState
} from '../../src/domain/types.ts';

const SAMPLE_ENTRY: VerifierEntry = {
  id: asVerifierEntryId('tv-shows:Fallout {tvdb-416744}'),
  category: 'tv-shows',
  mediaKind: 'tv',
  currentRootName: 'Fallout {tvdb-416744}',
  expectedRootName: 'Fallout (2024) {tvdb-416744}',
  issues: ['MISSING_YEAR', 'NON_STANDARD_SEASON_DIR'],
  steps: [
    {
      kind: 'season-dir',
      fromRelative: 'Fallout {tvdb-416744}/season 1',
      toRelative: 'Fallout {tvdb-416744}/Season 01'
    },
    {
      kind: 'root-dir',
      fromRelative: 'Fallout {tvdb-416744}',
      toRelative: 'Fallout (2024) {tvdb-416744}'
    }
  ],
  resolvedTitle: 'Fallout',
  resolvedYear: 2024
};

describe('VerifierView', () => {
  it('renders pre-scan prompt and status bar before first scan', () => {
    const state: VerifierState = {
      scanning: false,
      fixing: false,
      summary: null,
      entries: [],
      lastFixResult: null
    };
    const wrapper = mount(VerifierView, {
      props: { state, disabled: false }
    });
    expect(wrapper.text()).toContain('Click Scan Libraries to verify Plex naming compliance');
  });

  it('renders clean summary banner when all libraries are compliant', () => {
    const state: VerifierState = {
      scanning: false,
      fixing: false,
      summary: {
        librariesScanned: 5,
        totalRootsAnalyzed: 42,
        compliantRoots: 42,
        issueCount: 0,
        totalSeasonDirsAnalyzed: 110,
        totalFilesAnalyzed: 980,
        scannedAt: '2026-11-13T06:00:00Z'
      },
      entries: [],
      lastFixResult: null
    };
    const wrapper = mount(VerifierView, {
      props: { state, disabled: false }
    });
    expect(wrapper.text()).toContain('42 root folder(s)');
    expect(wrapper.text()).toContain('980 file(s)');
  });

  it('renders non-compliant entries, supports selection, and emits fix with selected IDs', async () => {
    const state: VerifierState = {
      scanning: false,
      fixing: false,
      summary: {
        librariesScanned: 5,
        totalRootsAnalyzed: 10,
        compliantRoots: 9,
        issueCount: 1,
        totalSeasonDirsAnalyzed: 12,
        totalFilesAnalyzed: 50,
        scannedAt: '2026-11-13T06:00:00Z'
      },
      entries: [SAMPLE_ENTRY],
      lastFixResult: null
    };
    const wrapper = mount(VerifierView, {
      props: { state, disabled: false }
    });
    expect(wrapper.text()).toContain('Fallout {tvdb-416744}');
    expect(wrapper.text()).toContain('Fallout (2024) {tvdb-416744}');

    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    await checkboxes[1]?.setValue(true);

    const emitted = wrapper.emitted('update:selectedIds');
    expect(emitted?.at(-1)?.[0]).toEqual([SAMPLE_ENTRY.id]);
  });

  it('filters by library and search query and toggles select-all visible', async () => {
    const state: VerifierState = {
      scanning: false,
      fixing: false,
      summary: {
        librariesScanned: 5,
        totalRootsAnalyzed: 2,
        compliantRoots: 0,
        issueCount: 2,
        totalSeasonDirsAnalyzed: 1,
        totalFilesAnalyzed: 2,
        scannedAt: '2026-11-13T06:00:00Z'
      },
      entries: [
        SAMPLE_ENTRY,
        {
          id: asVerifierEntryId('movies:Dune {imdb-tt1160419}'),
          category: 'movies',
          mediaKind: 'movie',
          currentRootName: 'Dune {imdb-tt1160419}',
          expectedRootName: 'Dune (2021) {imdb-tt1160419}',
          issues: ['MISSING_YEAR'],
          steps: [],
          resolvedTitle: 'Dune',
          resolvedYear: 2021
        }
      ],
      lastFixResult: {
        renamedFiles: 0,
        renamedDirs: 0,
        errors: ['Sample error']
      }
    };
    const wrapper = mount(VerifierView, {
      props: { state, disabled: false }
    });
    expect(wrapper.text()).toContain('Sample error');

    await wrapper.find('select').setValue('movies');
    expect(wrapper.text()).toContain('Dune {imdb-tt1160419}');
    expect(wrapper.text()).not.toContain('Fallout {tvdb-416744}');

    await wrapper.find('select').setValue('all');
    await wrapper.find('input[type="search"]').setValue('fallout');
    expect(wrapper.text()).toContain('Fallout {tvdb-416744}');
    expect(wrapper.text()).not.toContain('Dune {imdb-tt1160419}');

    const headerCheckbox = wrapper.find('thead input[type="checkbox"]');
    await headerCheckbox.setValue(true);
    expect(wrapper.emitted('update:selectedIds')?.at(-1)?.[0]).toEqual([SAMPLE_ENTRY.id]);
    await headerCheckbox.setValue(false);
    expect(wrapper.emitted('update:selectedIds')?.at(-1)?.[0]).toEqual([]);
  });

  it('groups file renames by folder panel and directory renames into a folders panel', () => {
    const groupedEntry: VerifierEntry = {
      id: asVerifierEntryId('animated-series:Batman Beyond {tvdb-75417}'),
      category: 'animated-series',
      mediaKind: 'tv',
      currentRootName: 'Batman Beyond {tvdb-75417}',
      expectedRootName: 'Batman Beyond (1999) {tvdb-75417}',
      issues: ['MISSING_YEAR', 'NON_STANDARD_FILENAME'],
      steps: [
        {
          kind: 'file',
          fromRelative:
            'Batman Beyond {tvdb-75417}/Season 01/Batman Beyond - s01e11 - Tinta mágica.mkv',
          toRelative:
            'Batman Beyond {tvdb-75417}/Season 01/Batman Beyond (1999) - s01e11 - Disappearing Inque.mkv'
        },
        {
          kind: 'file',
          fromRelative:
            'Batman Beyond {tvdb-75417}/Season 01/Batman Beyond - s01e12 - Un toque de Curaré.mkv',
          toRelative:
            'Batman Beyond {tvdb-75417}/Season 01/Batman Beyond (1999) - s01e12 - A Touch of Curare.mkv'
        },
        {
          kind: 'root-dir',
          fromRelative: 'Batman Beyond {tvdb-75417}',
          toRelative: 'Batman Beyond (1999) {tvdb-75417}'
        }
      ],
      resolvedTitle: 'Batman Beyond',
      resolvedYear: 1999
    };

    const state: VerifierState = {
      scanning: false,
      fixing: false,
      summary: {
        librariesScanned: 5,
        totalRootsAnalyzed: 1,
        compliantRoots: 0,
        issueCount: 1,
        totalSeasonDirsAnalyzed: 1,
        totalFilesAnalyzed: 2,
        scannedAt: '2026-11-13T06:00:00Z'
      },
      entries: [groupedEntry],
      lastFixResult: null
    };

    const wrapper = mount(VerifierView, {
      props: { state, disabled: false }
    });

    const panels = wrapper.findAll('.vo-plan-panel');
    expect(panels).toHaveLength(2);
    expect(panels[0]?.find('summary').text()).toContain('Batman Beyond {tvdb-75417} / Season 01');
    expect(panels[0]?.find('summary').text()).toContain('2');
    expect(panels[0]?.findAll('.vo-plan-diff-row')).toHaveLength(2);
    expect(panels[1]?.find('summary').text()).toContain('folders');
    expect(panels[1]?.findAll('.vo-plan-dir-row')).toHaveLength(1);

    const expectedCell = wrapper.find('.vo-diff-card--expected');
    expect(expectedCell.text()).toContain('Batman Beyond (1999) {tvdb-75417}');
    expect(expectedCell.text()).toContain('1999');
    expect(expectedCell.text()).toContain('3 step(s)');
    // Must not duplicate resolvedTitle twice inside the expected card
    expect(expectedCell.text().match(/Batman Beyond/g)).toHaveLength(1);

    const tvdbLink = expectedCell.find('a.vo-provider-link--tvdb');
    expect(tvdbLink.exists()).toBe(true);
    expect(tvdbLink.attributes('href')).toBe('https://www.thetvdb.com/dereferrer/series/75417');
    expect(tvdbLink.attributes('target')).toBe('_blank');
    expect(tvdbLink.find('svg.vo-provider-link__icon').exists()).toBe(true);
  });

  it('extracts TVDB, IMDb, and TMDB external verification links', async () => {
    const { extractExternalIdLinks } = await import('../../src/client/utils/formatters.ts');
    expect(extractExternalIdLinks('Dune (2021) {imdb-tt1160419}', 'movie')).toEqual([
      {
        provider: 'imdb',
        id: 'tt1160419',
        label: 'IMDb',
        url: 'https://www.imdb.com/title/tt1160419/'
      }
    ]);
    expect(extractExternalIdLinks('Show (2020) {tmdb-999}', 'tv')).toEqual([
      {
        provider: 'tmdb',
        id: '999',
        label: 'TMDB',
        url: 'https://www.themoviedb.org/tv/999'
      }
    ]);
  });
});
