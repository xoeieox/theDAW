import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useAppUiStore } from '../../state/appUiStore';

/**
 * The center workspace — CenterTabBar at the top + the active tab's
 * view filling the rest. The bottom multi-tab panel was extracted to
 * BottomMultiTabPanel.tsx and now lives in the global footer
 * (Shell.tsx) side-by-side with ProcessingLog. Each panel has its
 * own independent height (multiHeight / logHeight in bottomPanelStore)
 * and its own resize handle.
 *
 * Each tab view is code-split (React.lazy) so its JS — and its heavy
 * deps (wavesurfer, the force-graph engine, the chimera/effect stacks)
 * — only download when that tab is first opened, not in the initial
 * bundle. Each tab renders inside its OWN Suspense boundary so a
 * not-yet-loaded tab can't blank out a sibling.
 */
const WaveformEditor = lazy(() => import('../audio/WaveformEditor').then((m) => ({ default: m.WaveformEditor })));
const AdvancedView = lazy(() => import('../../views/AdvancedView').then((m) => ({ default: m.AdvancedView })));
const MixView = lazy(() => import('../../views/MixView').then((m) => ({ default: m.MixView })));
const LineageView = lazy(() => import('../library/LineageModal').then((m) => ({ default: m.LineageView })));
const UnderfitView = lazy(() => import('../../views/UnderfitView').then((m) => ({ default: m.UnderfitView })));

const TabFallback: React.FC = () => (
  <div className="absolute inset-0 grid place-items-center">
    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 animate-pulse">loading…</span>
  </div>
);

export const DAWCenterPanel: React.FC<{ onSwitchTab?: (tab: string) => void }> = ({ onSwitchTab }) => {
  const centerTab = useAppUiStore((s) => s.centerTab);

  // Track which heavy tabs have been opened at least once. We only mount
  // LEARN / UNDERFIT after first visit (so a user who never touches them
  // pays nothing), then keep them mounted permanently and toggle
  // visibility — preserving the LEARN genealogy graph's fetch + layout +
  // pan/zoom and the UNDERFIT dashboard state.
  const [warmedTabs, setWarmedTabs] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (centerTab === 'underfit' || centerTab === 'learn') {
      setWarmedTabs((prev) => {
        if (prev.has(centerTab)) return prev;
        const next = new Set(prev);
        next.add(centerTab);
        return next;
      });
    }
  }, [centerTab]);

  return (
    <div className="flex-1 h-full flex flex-col pt-1 px-0 pb-0 gap-2 bg-[#0a080f]/40 relative z-0 min-h-0">

      {/* Main workspace — the tab bar now lives in the global header; the active center
          tab takes the whole area. Bottom panel is rendered globally
          in Shell.tsx, no longer inside this card. */}
      <div className="flex-1 min-h-0 hardware-card flex flex-col mx-2 pt-1">
        <div className="flex-1 min-h-0 relative">
          {centerTab === 'make' && (
            <div className="absolute inset-0 overflow-hidden">
              <Suspense fallback={<TabFallback />}><AdvancedView /></Suspense>
            </div>
          )}
          {centerTab === 'edit' && (
            <Suspense fallback={<TabFallback />}><WaveformEditor onSwitchTab={onSwitchTab} /></Suspense>
          )}
          {centerTab === 'mix' && (
            // PROCESS → MIX. The MIX workspace on the Control-Surface editor
            // (MixView): 2 input/output viz rows up top (toggle waveform / live
            // scope, A/B overlay), the effect-chain workflow (rail + library +
            // chain) in the middle, and the effectStage below. Drag-arrangeable
            // in Design Mode like the DJ console.
            <div className="absolute inset-0 overflow-hidden">
              <Suspense fallback={<TabFallback />}><MixView /></Suspense>
            </div>
          )}
          {/* LEARN stays mounted once warmed so tab switches preserve the
              fetched graph, the computed layout, the DOM, and the user's
              pan/zoom. The `visible` prop tells the view when it is re-shown
              so it can refetch the cheap bulk graph endpoint and rebuild only
              if the library actually changed. */}
          {warmedTabs.has('learn') && (
            <div
              className="absolute inset-0"
              style={{ display: centerTab === 'learn' ? undefined : 'none' }}
            >
              <Suspense fallback={<TabFallback />}><LineageView rootEntryId={null} visible={centerTab === 'learn'} /></Suspense>
            </div>
          )}
          {warmedTabs.has('underfit') && (
            <div
              className="absolute inset-0"
              style={{ display: centerTab === 'underfit' ? undefined : 'none' }}
            >
              <Suspense fallback={<TabFallback />}><UnderfitView /></Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
