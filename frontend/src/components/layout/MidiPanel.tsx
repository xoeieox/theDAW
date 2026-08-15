/**
 * MidiPanel - the MIDI tab.
 *
 * The shared Piano Roll is the surface; the toolbar tools operate on it.
 * Notes export to .mid or drive a drum Beat; the chord-progression
 * arpeggiator is a second face that stays mounted while hidden so its
 * transport keeps running. No synthesis here.
 */

import { Download, Drum, Music4 } from 'lucide-react';
import React, { useCallback, useState } from 'react';

import type { RenderNote } from '../../lib/midiSynth';
import { notesToSmf } from '../../lib/midiWrite';
import { renderDrumBeatBlob, vocalizeEffect } from '../../lib/vocalBeat';
import { usePianoRollStore, type PianoNote } from '../../state/pianoRollStore';
import { usePlayerStore } from '../../state/playerStore';
import { PianoRoll } from '../audio/PianoRoll';
import { ArpeggiatorPanel } from '../audio/ArpeggiatorPanel';
import { VirtuosoControls } from '../audio/VirtuosoControls';

const stepSec = (bpm: number): number => 60 / bpm / 4;

const pianoToRender = (notes: PianoNote[], bpm: number): RenderNote[] => {
  const ss = stepSec(bpm);
  return notes.map((n) => ({
    midi: n.note,
    startSec: n.step * ss,
    durationSec: Math.max(0.05, n.length * ss),
    velocity: n.velocity,
  }));
};

export const MidiPanel: React.FC = () => {
  const [status, setStatus] = useState('idle');
  const [arpOn, setArpOn] = useState(false);

  const exportMidi = useCallback(() => {
    const { notes, bpm } = usePianoRollStore.getState();
    if (!notes.length) {
      setStatus('no notes to export');
      return;
    }
    // Export exactly what is in the roll (post-edit) via the canonical
    // RenderNote -> SMF writer.
    const smf = notesToSmf(pianoToRender(notes, bpm));
    const blob = new Blob([smf as BlobPart], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'midi.mid';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    setStatus(`exported ${notes.length} notes to .mid`);
  }, []);

  const makeBeat = useCallback(async () => {
    const { notes, bpm } = usePianoRollStore.getState();
    if (!notes.length) {
      setStatus('no notes for a beat');
      return;
    }
    const render = pianoToRender(notes, bpm);
    setStatus('rendering beat...');
    try {
      const { blob } = await renderDrumBeatBlob(render);
      const span = Math.max(...render.map((r) => r.startSec)) + 0.5;
      const fx = vocalizeEffect(render, span);
      // The beat routes through the footer player so the global transport,
      // visualizer, and HUD own its playback instead of a detached element.
      const player = usePlayerStore.getState();
      await player.load(blob, { label: 'MIDI beat' });
      // The beat preview is a one-shot. load() applies the store's loop flag
      // (default true) and has no per-load override, so the visible footer loop
      // toggle is switched off before play; re-enabling it is one click.
      const { isLooping, toggleLoop } = usePlayerStore.getState();
      if (isLooping) toggleLoop();
      player.play();
      setStatus(`beat playing - fx idea: ${fx.effectId} (${fx.reason})`);
    } catch (e) {
      setStatus(`beat error: ${String(e)}`);
    }
  }, []);

  const btn =
    'flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wide rounded border transition-colors disabled:opacity-40';

  return (
    <div className="h-full w-full flex flex-col bg-zinc-950 text-zinc-200">
      {/* tools toolbar — everything operates on the roll */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-white/8">
        <button
          type="button"
          onClick={exportMidi}
          title="Download the current roll as a Standard MIDI (.mid) file"
          className={`${btn} border-zinc-500 text-zinc-200 hover:bg-white/10`}
        >
          <Download className="w-3 h-3" />
          .mid
        </button>
        <button
          type="button"
          onClick={makeBeat}
          title="Render a General MIDI drum beat from the notes (low/mid/high -> kick/snare/hat) and play it"
          className={`${btn} border-amber-600 text-amber-300 hover:bg-amber-600/15`}
        >
          <Drum className="w-3 h-3" />
          Beat
        </button>

        <span className="w-px h-4 bg-white/10" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setArpOn((v) => !v)}
          aria-pressed={arpOn}
          title={arpOn ? 'Back to the piano roll' : 'Chord-progression arpeggiator'}
          className={`${btn} ${
            arpOn
              ? 'border-amber-400 text-amber-200 bg-amber-400/20'
              : 'border-amber-600 text-amber-300 hover:bg-amber-600/15'
          }`}
        >
          <Music4 className="w-3 h-3" />
          Arp
        </button>
        <span className="text-[10px] font-mono text-zinc-500 truncate min-w-0 flex-1 text-right">
          {status}
        </span>
      </div>

      {/* Virtuoso morph strip — shared across the piano roll and arp faces so the
          transform amounts are always reachable without switching. */}
      <VirtuosoControls />

      {/* body: piano roll (or the arpeggiator face). The arpeggiator stays
          mounted but hidden so its transport keeps running when toggling back
          to the roll. */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          <div className={arpOn ? 'hidden' : 'absolute inset-0'}>
            <PianoRoll />
          </div>
          <div className={arpOn ? 'absolute inset-0' : 'hidden'}>
            <ArpeggiatorPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
