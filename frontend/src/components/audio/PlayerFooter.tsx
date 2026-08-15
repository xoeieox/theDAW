import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Download, Share2, Heart, Repeat, VolumeX, Maximize2, MoreHorizontal, Cast, Check, Search } from 'lucide-react';
import { useGenerateStore } from '../../state/generateStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { usePlayerStore } from '../../state/playerStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useAppUiStore } from '../../state/appUiStore';
import { callEditorPlay, isEditorPlaybackRegistered } from '../../state/editorPlaybackBridge';
import { SlideTrack } from './SlideTrack';

const formatDuration = (sec: number | null | undefined): string => {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const PlayerFooter: React.FC = () => {
  const [isLiked, setIsLiked] = useState(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // G-Search lives in the footer now (global on every tab). Drives the library
  // search store; typing opens the library rail. Ctrl/Cmd-K focuses it.
  const setLibrarySearch = useLibraryStore((s) => s.setSearchQuery);
  const librarySearch = useLibraryStore((s) => s.searchQuery);
  const setRightPanelOpen = useAppUiStore((s) => s.setRightPanelOpen);
  const isRightPanelOpen = useAppUiStore((s) => s.isRightPanelOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Volume / mute live in playbackStore; they drive the engine's master gain.
  const volume = usePlaybackStore((s) => s.volume);
  const setVolume = usePlaybackStore((s) => s.setVolume);
  const isMuted = usePlaybackStore((s) => s.muted);
  const toggleMute = usePlaybackStore((s) => s.toggleMute);

  // Engine state
  const engineLabel = usePlayerStore((s) => s.currentLabel);
  const engineDuration = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLooping = usePlayerStore((s) => s.isLooping);
  const hasTrack = usePlayerStore((s) => s.hasTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const seekByFraction = usePlayerStore((s) => s.seekByFraction);
  const toggleLoop = usePlayerStore((s) => s.toggleLoop);
  const setMasterGain = usePlayerStore((s) => s.setMasterGain);
  const load = usePlayerStore((s) => s.load);
  const currentEntryId = usePlayerStore((s) => s.currentEntryId);
  const libraryEntries = useLibraryStore((s) => s.entries);

  // Last-generation metadata (used when nothing's been explicitly loaded yet).
  const lastFilename = useGenerateStore((s) => s.lastFilename);
  const lastDurationSec = useGenerateStore((s) => s.lastDurationSec);
  const lastModelName = useGenerateStore((s) => s.lastModelName);

  // Editor mode — when the EDIT tab is active and editor bridge is registered,
  // the first play click triggers an offline render into playerStore.
  // After that, all transport (seek, skip, loop, volume) works natively.
  const activeView = useAppUiStore((s) => s.activeView);
  const inEditorMode = activeView === 'edit' && isEditorPlaybackRegistered();

  // Volume → master gain (continuous).
  useEffect(() => {
    setMasterGain(isMuted ? 0 : volume / 100);
  }, [volume, isMuted, setMasterGain]);

  // Auto-load: when a new generation lands and nothing is currently loaded, load it.
  useEffect(() => {
    if (hasTrack) return;
    const entries = useLibraryStore.getState().entries;
    if (entries.length === 0) return;
    const newest = entries.reduce((acc, e) => (e.timestamp.localeCompare(acc.timestamp) > 0 ? e : acc), entries[0]);
    if (newest) {
      void (async () => {
        const blob = await useLibraryStore.getState().fetchAudioBlob(newest);
        await load(blob, { label: newest.title, entryId: newest.id });
      })();
    }
  }, [hasTrack, lastFilename, load]);

  const displayLabel = engineLabel ?? lastFilename ?? null;
  const displayDuration = engineDuration > 0 ? engineDuration : (lastDurationSec ?? 0);
  const displayCurrentTime = currentTime;
  // The transport icon reflects whatever is ACTUALLY producing output: the
  // global engine (library / make / edit — `isPlaying` also covers editor
  // playback, which loads into the engine).
  const displayIsPlaying = isPlaying;
  const progressPct = displayDuration > 0 ? Math.min(100, (displayCurrentTime / displayDuration) * 100) : 0;

  const handleToggle = () => {
    // In editor mode, if editor audio isn't loaded yet, trigger the offline render+play.
    // Once loaded (entryId === 'editor-timeline'), toggle works natively.
    if (inEditorMode && currentEntryId !== 'editor-timeline') {
      callEditorPlay();
    } else {
      toggle();
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = progressRef.current;
    if (!el || displayDuration <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    seekByFraction(frac);
  };

  const handleDownload = () => {
    const entries = useLibraryStore.getState().entries;
    const target = entries.find((e) => e.id === currentEntryId) ?? entries[0];
    if (!target) return;
    const url = useLibraryStore.getState().getAudioUrl(target);
    const a = document.createElement('a');
    a.href = url;
    a.download = target.title;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // "Up next" — no formal play queue yet, so derive the next track from the
  // library in newest-first order (wraps at the end). Clicking it loads it.
  const nextEntry = React.useMemo(() => {
    if (libraryEntries.length === 0) return null;
    const sorted = [...libraryEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (!currentEntryId) return sorted[0] ?? null;
    const idx = sorted.findIndex((e) => e.id === currentEntryId);
    if (idx < 0) return sorted[0] ?? null;
    return sorted[(idx + 1) % sorted.length] ?? null;
  }, [libraryEntries, currentEntryId]);

  const loadNext = () => {
    if (!nextEntry) return;
    void (async () => {
      const blob = await useLibraryStore.getState().fetchAudioBlob(nextEntry);
      await load(blob, { label: nextEntry.title, entryId: nextEntry.id });
    })();
  };

  return (
    <footer className="fixed bottom-0 left-0 right-0 h-20 bg-[#0a080f]/95 backdrop-blur-xl border-t border-white/5 z-50 px-6 flex items-center gap-6 group">
      {/* 1. G-Search + Now Playing. flex-1 (mirrors section 3) so the now-playing
          readout fills the space between G-Search and the centred transport, and
          the PLAY button still lands on the true viewport centre. The orb
          assistant overlaps the bottom-left corner, so pad left to clear it. */}
      <div className="flex items-center gap-3 flex-1 min-w-0 pl-20">
        {/* G-Search — global library search, available on every tab. */}
        <div className="flex items-center gap-2 px-2.5 py-1 bg-white/5 rounded-full border border-white/5 shrink-0">
          <Search className="w-3 h-3 text-zinc-600" />
          <input
            id="global-search"
            name="global-search"
            ref={searchRef}
            type="search"
            aria-label="Global library search (Ctrl-K / Cmd-K)"
            placeholder="G-SEARCH (ctrl-k)"
            className="bg-transparent border-none outline-none text-[9px] text-zinc-300 w-24 font-mono placeholder:text-zinc-500"
            value={librarySearch}
            onChange={(e) => {
              setLibrarySearch(e.target.value);
              if (e.target.value && !isRightPanelOpen) setRightPanelOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setLibrarySearch('');
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <h4 className="text-[13px] font-bold text-zinc-100 truncate tracking-tight">
            {displayLabel ?? 'No output loaded'}
          </h4>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-purple-400 font-mono uppercase tracking-widest border border-purple-500/20 px-1 rounded bg-purple-500/5">
              {lastModelName ? lastModelName.toUpperCase() : (displayLabel ? 'LIBRARY' : 'IDLE')}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {displayDuration > 0 ? `${formatDuration(displayDuration)} // 48kHz` : '--:-- // 48kHz'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setIsLiked(!isLiked)} className={`p-1.5 transition-colors ${isLiked ? 'text-pink-500' : 'text-zinc-600 hover:text-white'}`}>
             <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-current' : ''}`} />
          </button>
          <button className="p-1.5 text-zinc-600 hover:text-white transition-colors">
             <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Main Transport Control — fixed-width + centred between the two
          flex-1 side sections so the PLAY button stays on the viewport centre. */}
      <div className="shrink-0 w-136 max-w-2xl min-w-0 flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-8">
          <button
            onClick={toggleLoop}
            className={`p-1 transition-colors ${isLooping ? 'text-purple-400' : 'text-zinc-600 hover:text-white'}`}
            title={isLooping ? 'Looping on' : 'Looping off'}
          >
            <Repeat className="w-4 h-4" />
          </button>
          <button
            onClick={() => seekByFraction(0)}
            className="text-zinc-500 hover:text-white transition-colors disabled:opacity-30"
            disabled={!inEditorMode && !hasTrack}
            title="Jump to start"
          >
            <SkipBack className="w-5 h-5 fill-current" />
          </button>
          <button
            onClick={handleToggle}
            disabled={!inEditorMode && !hasTrack}
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(255,255,255,0.2)] disabled:opacity-40 disabled:pointer-events-none"
            title={displayIsPlaying ? 'Pause' : 'Play'}
          >
            {displayIsPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => seekByFraction(1)}
            className="text-zinc-500 hover:text-white transition-colors disabled:opacity-30"
            disabled={!hasTrack}
            title="Jump to end"
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void document.documentElement.requestFullscreen();
              }
            }}
            className="p-1 text-zinc-600 hover:text-white transition-colors"
            title="Toggle fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        <div className="w-full flex items-center gap-3">
          <span className="text-[10px] font-mono text-zinc-500 w-8 text-right">{formatDuration(displayCurrentTime)}</span>
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            className="flex-1 h-0.75 bg-white/5 rounded-full relative group/bar cursor-pointer"
          >
            <div className="absolute inset-0 bg-white/5" />
            <div
              className="absolute inset-y-0 left-0 bg-linear-to-r from-purple-600 to-purple-400 rounded-full"
              style={{ width: `${progressPct}%` }}
            >
              <div className="hidden group-hover/bar:block absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
            </div>
          </div>
          <span className="text-[10px] font-mono text-zinc-500 w-8">{formatDuration(displayDuration)}</span>
        </div>
      </div>

      {/* 3. Up Next (mirrors Now Playing) + Utilities. flex-1 (mirrors section 1)
          so the up-next readout fills the space between the transport and the
          utilities, right-aligned. The pr-20 mirrors section 1's pl-20 (orb
          clearance) so the two flex-1 sides stay equal and the transport — and
          its PLAY button — lands on the true viewport centre (aligned with the
          bottom-panel expand chevron). */}
      <div className="flex items-center gap-3 flex-1 min-w-0 justify-end pr-20">
        {/* Up Next — mirror of the Now Playing block, right-aligned. Click loads
            the next track (no formal queue yet, so it's the next library entry). */}
        <button
          type="button"
          onClick={loadNext}
          disabled={!nextEntry}
          title={nextEntry ? `Play next: ${nextEntry.title}` : 'Nothing queued'}
          className="group/next flex flex-col min-w-0 flex-1 items-end text-right disabled:cursor-default"
        >
          <h4 className="text-[13px] font-bold text-zinc-300 group-hover/next:text-white transition-colors truncate tracking-tight w-full">
            {nextEntry?.title ?? 'Nothing queued'}
          </h4>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-mono">
              {nextEntry ? formatDuration(nextEntry.duration) : '--:--'}
            </span>
            <span className="text-[9px] text-emerald-400 font-mono uppercase tracking-widest border border-emerald-500/20 px-1 rounded bg-emerald-500/5">
              Up Next
            </span>
          </div>
        </button>
        <div className="flex items-center gap-5 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={toggleMute} className="text-zinc-500 hover:text-white transition-colors" title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <SlideTrack min={0} max={100} step={1} value={volume}
              onChange={(v) => setVolume(v)} className="w-20" ariaLabel="Volume" />
          </div>

          <div className="h-6 w-px bg-white/5" />

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={!hasTrack}
              className="p-2 border border-white/5 rounded-lg hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-zinc-500 hover:text-purple-400 disabled:opacity-30 disabled:pointer-events-none"
              title="Download current track"
            >
               <Download className="w-4 h-4" />
            </button>
            <button className="p-2 border border-white/5 rounded-lg hover:border-white/20 transition-all text-zinc-500 hover:text-white">
               <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

    </footer>
  );
};

