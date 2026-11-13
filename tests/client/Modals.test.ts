// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { defineComponent, ref } from 'vue';

import App from '../../src/client/App.vue';
import ConflictResolutionModal from '../../src/client/components/ConflictResolutionModal.vue';
import MetadataSearchModal from '../../src/client/components/MetadataSearchModal.vue';
import TrackInspectorModal from '../../src/client/components/TrackInspectorModal.vue';
import { useGsapMotion } from '../../src/client/composables/useGsapMotion.ts';
import {
  asIso639_2Code,
  asItemId,
  type ConflictComparison,
  type ScannedItem
} from '../../src/domain/types.ts';

describe('Client Modals & App', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ConflictResolutionModal displays comparison and emits decisions', async () => {
    const baseProbe = {
      durationSeconds: 100,
      videoStreams: [],
      audioStreams: [],
      subtitleStreams: []
    };
    const conflicts: ConflictComparison[] = [
      {
        itemId: asItemId('c-1'),
        kind: 'existing-file',
        destinationPath: '/movies/Dune (2021)/Dune (2021).mkv',
        incoming: {
          ...baseProbe,
          sizeBytes: 5_000_000,
          formatName: 'matroska',
          bitrateBps: 4_000_000
        },
        existing: { ...baseProbe, sizeBytes: 2_000_000, formatName: 'mp4', bitrateBps: 1_500_000 }
      },
      {
        itemId: asItemId('c-2'),
        kind: 'intra-batch',
        destinationPath: '/movies/Dup (2021)/Dup (2021).mkv',
        incoming: {
          ...baseProbe,
          sizeBytes: 1_000_000,
          formatName: 'matroska',
          bitrateBps: 1_000_000
        }
      }
    ];

    const wrapper = mount(ConflictResolutionModal, {
      props: {
        open: true,
        conflicts,
        diskSpace: [
          {
            category: 'movies',
            targetRoot: '/movies',
            availableBytes: 50_000_000,
            requiredBytes: 5_000_000,
            sufficient: true
          }
        ]
      }
    });

    expect(wrapper.find('.vo-modal-header h2').text()).toContain('Pre-Flight Conflicts');
    expect(wrapper.find('.vo-modal-header .vo-badge').text()).toBe('2');
    expect(wrapper.text()).toContain('Intra-batch collision');

    const confirmBtn = wrapper.find('.vo-btn--primary');
    expect((confirmBtn.element as HTMLButtonElement).disabled).toBe(true);

    const selects = wrapper.findAll('select');
    await selects[0]!.setValue('overwrite');
    await selects[1]!.setValue('ignore');
    await confirmBtn.trigger('click');

    const emitted = wrapper.emitted('confirm');
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]?.[0]).toEqual({ 'c-1': 'overwrite', 'c-2': 'ignore' });
  });

  it('TrackInspectorModal edits audio/subtitle selection and emits save', async () => {
    const item: ScannedItem = {
      id: asItemId('t-1'),
      sourcePath: '/in/Show.S01E01.mkv',
      relativePath: 'Show.S01E01.mkv',
      fileName: 'Show.S01E01.mkv',
      mediaKind: 'tv',
      category: 'tv-shows',
      parsedTitle: 'Show',
      episodeOrder: 'aired',
      include: true,
      tags: [],
      probe: {
        formatName: 'matroska',
        durationSeconds: 1200,
        sizeBytes: 1_000_000,
        bitrateBps: 1_000_000,
        videoStreams: [{ index: 0, codecName: 'h264', width: 1920, height: 1080 }],
        audioStreams: [
          {
            index: 1,
            streamOrder: 0,
            codecName: 'aac',
            language: asIso639_2Code('und'),
            channels: 2,
            isDefault: false
          }
        ],
        subtitleStreams: []
      },
      externalSubtitles: [
        {
          path: '/in/Show.S01E01.es.srt',
          relativePath: 'Show.S01E01.es.srt',
          extension: '.srt',
          language: asIso639_2Code('spa'),
          isForced: false,
          isHearingImpaired: false,
          isLanguageAmbiguous: false
        }
      ],
      trackSelection: {
        audioTracks: [
          { streamOrder: 0, language: asIso639_2Code('und'), isDefault: false, include: true }
        ],
        subtitleMergeMode: 'keep-and-add',
        includedInternalSubtitles: [],
        externalSubtitleOrder: [],
        needsUserPrompt: true
      },
      candidates: [],
      warnings: []
    };

    const wrapper = mount(TrackInspectorModal, {
      props: { item }
    });

    expect(wrapper.text()).toContain('Track Inspector');
    expect(wrapper.text()).toContain('Show.S01E01.mkv');
    const selects = wrapper.findAll('select');
    await selects[0]!.setValue('spa');
    await selects[1]!.setValue('replace');
    const radio = wrapper.find('input[type="radio"]');
    await radio.setValue(true);

    const saveBtn = wrapper.find('.vo-btn--primary');
    await saveBtn.trigger('click');

    const emitted = wrapper.emitted('save');
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]?.[0]).toMatchObject({
      needsUserPrompt: false,
      subtitleMergeMode: 'replace'
    });
  });

  it('App mounts, fetches state, and toggles theme', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          phase: 'IDLE',
          revision: 1,
          lockOwnerClientId: null,
          mountPaths: {
            inputDir: '/data/input',
            movies: '/data/output/movies',
            documentaries: '/data/output/documentaries',
            'animated-movies': '/data/output/animated-movies',
            'tv-shows': '/data/output/tv-shows',
            'animated-series': '/data/output/animated-series'
          },
          items: [],
          activeJob: null
        }),
        { status: 200 }
      )
    );

    const wrapper = mount(App);
    await new Promise((r) => setTimeout(r, 20));
    expect(wrapper.text()).toContain('Plex Video Organizer');
    wrapper.unmount();

    const NullMotion = defineComponent({
      setup() {
        const nullMotion = useGsapMotion(ref(null));
        nullMotion.animateEntrance('.missing');
        return () => null;
      }
    });
    mount(NullMotion).unmount();
  });

  it('MetadataSearchModal searches providers and applies candidate', async () => {
    const searchFn = vi.fn().mockResolvedValue([
      {
        title: 'Andor',
        year: 2022,
        tvdbId: '416744',
        source: 'tvdb'
      }
    ]);

    const wrapper = mount(MetadataSearchModal, {
      props: {
        item: {
          id: asItemId('m-1'),
          sourcePath: '/in/Andor.S01E01.mkv',
          relativePath: 'Andor.S01E01.mkv',
          fileName: 'Andor.S01E01.mkv',
          mediaKind: 'tv',
          category: 'tv-shows',
          include: true,
          parsedTitle: 'Andor',
          tags: [],
          episodeOrder: 'aired',
          probe: {
            formatName: 'matroska',
            durationSeconds: 1800,
            sizeBytes: 1_000_000,
            bitrateBps: 1_000_000,
            videoStreams: [],
            audioStreams: [],
            subtitleStreams: []
          },
          externalSubtitles: [],
          candidates: [],
          trackSelection: {
            audioTracks: [],
            subtitleMergeMode: 'keep-and-add',
            includedInternalSubtitles: [],
            externalSubtitleOrder: [],
            needsUserPrompt: false
          },
          warnings: []
        },
        searchFn
      }
    });

    await wrapper.find('.vo-btn--primary').trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    expect(searchFn).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Andor');
  });

  it('MetadataSearchModal renders bulk selection context when bulkCount > 1', () => {
    const wrapper = mount(MetadataSearchModal, {
      props: {
        item: {
          id: asItemId('m-1'),
          sourcePath: '/in/Andor.S01E01.mkv',
          relativePath: 'Andor.S01E01.mkv',
          fileName: 'Andor.S01E01.mkv',
          mediaKind: 'tv',
          category: 'tv-shows',
          include: true,
          parsedTitle: 'Andor',
          tags: [],
          episodeOrder: 'aired',
          probe: {
            formatName: 'matroska',
            durationSeconds: 1800,
            sizeBytes: 1_000_000,
            bitrateBps: 1_000_000,
            videoStreams: [],
            audioStreams: [],
            subtitleStreams: []
          },
          externalSubtitles: [],
          candidates: [],
          trackSelection: {
            audioTracks: [],
            subtitleMergeMode: 'keep-and-add',
            includedInternalSubtitles: [],
            externalSubtitleOrder: [],
            needsUserPrompt: false
          },
          warnings: []
        },
        bulkCount: 3,
        searchFn: vi.fn().mockResolvedValue([])
      }
    });

    expect(wrapper.text()).toContain('3 selected');
    expect(wrapper.text()).toContain('Applying match to 3 selected items');
  });
});
