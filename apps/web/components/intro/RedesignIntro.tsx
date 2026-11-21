'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { introSteps, markIntroSeen, type IntroStepId } from '@/lib/redesignIntro';
import { cn } from '@/lib/utils';
import s from './RedesignIntro.module.css';

/** The tour's tips cycle at this pace (ms). */
const TIP_MS = 3200;

function Mini({ children, navClass = '' }: { children: ReactNode; navClass?: string }) {
  return (
    <div className={s.mini}>
      {children}
      <div className={cn(s.nav, navClass)}>
        <b className={s.on} />
        <b />
        <b />
      </div>
    </div>
  );
}

const blk = (style: React.CSSProperties, key?: number) => <div key={key} className={s.blk} style={style} />;

function ArtNew() {
  return (
    <Mini>
      <div className={cn(s.pad, s.s1)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {blk({ height: 10, width: '55%', animationDelay: '0s' })}
        <div className={s.grid2}>
          {blk({ height: 22, animationDelay: '.15s' })}
          {blk({ height: 22, animationDelay: '.25s' })}
        </div>
        {blk({ height: 8, width: '40%', animationDelay: '.4s' })}
        <div className={s.grid2}>
          {blk({ height: 52, animationDelay: '.55s', background: 'linear-gradient(135deg,#f2b79c,#c98a70)' })}
          {blk({ height: 52, animationDelay: '.7s', background: 'linear-gradient(135deg,#c9c3dd,#8f88ab)' })}
        </div>
        {blk({ height: 8, width: '45%', animationDelay: '.85s' })}
        <div className={s.grid2}>
          {blk({ height: 40, animationDelay: '1s' })}
          {blk({ height: 40, animationDelay: '1.1s' })}
        </div>
      </div>
    </Mini>
  );
}

function ArtSwipe() {
  return (
    <div className={s.mini}>
      <div className={s.strip}>
        <div>
          <h5>Home</h5>
          <div className={s.grid2}>
            {blk({ height: 20 })}
            {blk({ height: 20 })}
          </div>
          <div className={s.grid2}>
            {blk({ height: 50 })}
            {blk({ height: 50 })}
          </div>
        </div>
        <div>
          <h5>Search</h5>
          {blk({ height: 16, borderRadius: 99 })}
          <div className={s.grid2}>
            {blk({ height: 34, background: '#5b3a6b' })}
            {blk({ height: 34, background: '#2e5b5f' })}
            {blk({ height: 34, background: '#6b5a2e' })}
            {blk({ height: 34, background: '#3a4f6b' })}
          </div>
        </div>
        <div>
          <h5>Library</h5>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {blk({ width: 18, height: 18 })}
              {blk({ height: 6, flex: 1 })}
            </div>
          ))}
        </div>
      </div>
      <div className={s.finger} />
      <div className={cn(s.nav, s.navcycle)}>
        <b />
        <b />
        <b />
      </div>
    </div>
  );
}

/** The three tips of the tour, each a small scene. */
const TIPS: { label: string; scene: () => ReactNode }[] = [
  {
    label: 'Rows show whole cards. Show all opens the full list.',
    scene: () => (
      <div className={cn(s.pad, s.tRows)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {blk({ height: 7, width: '45%' })}
          <span className={s.showall}>Show all</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div className={s.card} />
          <div className={s.card} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {blk({ height: 7, width: '40%' })}
          <span className={s.showall} style={{ animationDelay: '1.5s' }}>
            Show all
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div className={s.card} />
          <div className={s.card} />
        </div>
      </div>
    ),
  },
  {
    label: 'Tap the magnifier to search inside any playlist.',
    scene: () => (
      <div className={s.pad} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {blk({ height: 50, width: 50 })}
        {blk({ height: 9, width: '70%' })}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--i-ember)' }} />
          {blk({ width: 18, height: 18, borderRadius: '50%' })}
          <div className={s.mag}>⌕</div>
        </div>
        <div className={s.field}>dorde bal</div>
        {[0, 1, 2].map((i) => blk({ height: 6 }, i))}
      </div>
    ),
  },
  {
    label: 'Queue and Lyrics sit right under the play buttons.',
    scene: () => (
      <div className={s.pad} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {blk({ height: 84, background: 'linear-gradient(135deg,#3a2a24,#141012)' })}
        {blk({ height: 7, width: '60%' })}
        {blk({ height: 3 })}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--i-muted)' }}>⏮</span>
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: 'var(--i-muted)' }}>⏭</span>
        </div>
        <div className={s.prow}>
          <span>▭</span>
          <span>
            <span className={s.q}>≡</span>
            &nbsp;&nbsp;
            <span className={s.q} style={{ animationDelay: '1.5s' }}>
              🎤︎
            </span>
          </span>
        </div>
      </div>
    ),
  },
];

function ArtTour() {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((n) => (n + 1) % TIPS.length), TIP_MS);
    return () => clearInterval(t);
  }, []);
  const cur = TIPS[tip];
  return (
    <div className={s.tour}>
      {/* keyed by tip, so each scene's animations start over like the mockup's innerHTML swap */}
      <div className={s.mini} key={tip} data-testid="intro-tour-scene">
        {cur.scene()}
        <div className={s.nav}>
          <b className={s.on} />
          <b />
          <b />
        </div>
      </div>
      <div className={s.tiplabel} aria-live="polite">
        {cur.label}
      </div>
    </div>
  );
}

function ArtClassic() {
  const bar = (style: React.CSSProperties, key?: number) => <i key={key} style={style} />;
  return (
    <div className={s.legacy}>
      <div className={s.setrow}>
        <div>
          Classic layout<small>Use the previous design</small>
        </div>
        <div className={s.toggle} />
      </div>
      <div className={s.pair}>
        <div>
          <div className={cn(s.ui, s.new)}>
            {bar({ height: 10, width: '60%' })}
            {[0, 1, 2].map((i) => bar({ height: 22 }, i))}
          </div>
          <div className={s.cap}>New</div>
        </div>
        <div>
          <div className={cn(s.ui, s.old)}>
            {bar({ height: 8, width: '80%' })}
            {[0, 1, 2, 3].map((i) => bar({ height: 14 }, i))}
          </div>
          <div className={s.cap}>Classic</div>
        </div>
      </div>
    </div>
  );
}

function ArtFix({ onFix }: { onFix: () => void }) {
  return (
    <div className={s.fb}>
      <div className={s.bubble}>The Queue button is hard to find</div>
      <div className={cn(s.bubble, s.me)}>Thanks! We&apos;ll look at it.</div>
      <button className={s.fixbtn} type="button" onClick={onFix}>
        Send a fix request
      </button>
    </div>
  );
}

const COPY: Record<IntroStepId, { eyebrow: string; title: string; text: string }> = {
  new: {
    eyebrow: 'New',
    title: 'The new Ember is here',
    text: 'A fresh look for Home, playlists, the player and more. Same music, same library, nothing lost.',
  },
  swipe: {
    eyebrow: 'Tip',
    title: 'Swipe to switch tabs',
    text: 'Swipe left or right anywhere on Home, Search or Library to move between them. Tapping the bar at the bottom still works too.',
  },
  tour: { eyebrow: 'Quick tour', title: 'A few things that moved', text: '' },
  classic: {
    eyebrow: 'Your choice',
    title: 'Prefer the old look?',
    text: 'Switch back any time in Settings under Classic layout, and switch again whenever you like. Your music and playlists stay the same in both.',
  },
  fix: {
    eyebrow: 'Tell us',
    title: 'Something not right?',
    text: 'If something in the new design bugs you, send a fix request. It goes straight to the people making Ember.',
  },
};

interface RedesignIntroProps {
  open: boolean;
  /** Closing by any way: Start listening, Escape, the backdrop. */
  onClose: () => void;
  /** "Send a fix request": the host closes the intro and opens the dialog. */
  onFixRequest: () => void;
  /** Test seam: the steps' flag overrides. */
  classic?: boolean;
}

/** The "new design" intro: five short steps (swipe is phone-only, Classic
 *  waits for its switch, lib/redesignIntro). A bottom sheet on a phone, a
 *  centred card on desktop. */
export function RedesignIntro({ open, onClose, onFixRequest, classic }: RedesignIntroProps) {
  const desktop = useIsDesktop();
  const steps = introSteps({ desktop, classic });
  const [index, setIndex] = useState(0);
  const idx = Math.min(index, steps.length - 1);
  const id = steps[idx];
  const last = idx === steps.length - 1;
  const copy = COPY[id];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Reaching the end counts as having seen it (Skip jumps there).
  useEffect(() => {
    if (open && last) markIntroSeen();
  }, [open, last]);

  const close = () => {
    markIntroSeen();
    onClose();
  };

  const art: Record<IntroStepId, ReactNode> = {
    new: <ArtNew />,
    swipe: <ArtSwipe />,
    tour: <ArtTour />,
    classic: <ArtClassic />,
    fix: <ArtFix onFix={onFixRequest} />,
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={s.scrim} data-testid="intro-backdrop" />
        <Dialog.Popup className={cn(s.sheet, s.root)} data-redesign-intro>
          <div className={s.top}>
            <div className={s.dots} aria-hidden="true">
              {steps.map((st, i) => (
                <span key={st} className={i === idx ? s.on : undefined} />
              ))}
            </div>
            <button
              type="button"
              className={s.skip}
              style={{ visibility: last ? 'hidden' : 'visible' }}
              onClick={() => setIndex(steps.length - 1)}
            >
              Skip
            </button>
          </div>
          <div className={s.art}>
            <div className={s.swap} key={id}>
              {art[id]}
            </div>
          </div>
          <div className={s.copy}>
            <div className={s.swapCopy} key={id}>
              <div className={s.eyebrow}>{copy.eyebrow}</div>
              <Dialog.Title className={s.title}>{copy.title}</Dialog.Title>
              {copy.text && <p className={s.text}>{copy.text}</p>}
            </div>
          </div>
          <div className={s.actions}>
            <button type="button" hidden={idx === 0} onClick={() => setIndex(idx - 1)}>
              Back
            </button>
            <button type="button" className={s.primary} onClick={() => (last ? close() : setIndex(idx + 1))}>
              {last ? 'Start listening' : 'Next'}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
