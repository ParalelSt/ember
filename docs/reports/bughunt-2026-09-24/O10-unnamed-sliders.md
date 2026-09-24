# O10. Seek and volume sliders had no name, and seek read out a percentage

**What you'd notice:** with a screen reader, tabbing to the playback
progress bar or the volume control just announced "slider", with no word
for what it controlled. Moving the seek slider read out a bare number like
"42 percent" instead of anything about the song.

**Why it happened:** the underlying `Slider` component already had a
`thumbLabel` prop for exactly this (an accessible name for the thumb,
separate from the invisible-to-input `aria-label` a `<div>` would get), but
neither `SeekBar` nor `VolumeControl` ever passed it. Nothing set a custom
value readout either, so the browser fell back to reporting the raw 0-100
number underneath the slider.

**What changed:** `SeekBar` now passes `thumbLabel="Seek"` and a
`getAriaValueText` that reads "1:23 of 3:45" (the same times already shown
next to the bar) instead of a percentage; `VolumeControl` passes
`thumbLabel="Volume"`. The wrapper (`components/ui/slider.tsx`) now forwards
`getAriaValueText` to the underlying thumb the same way it already forwarded
`thumbLabel`. Files: `components/ui/slider.tsx`,
`components/player/SeekBar.tsx`, `components/player/VolumeControl.tsx`.

**Compare:** before = `dbb9173`, after = `3d966b1`.
- Test: `cd apps/web && npx vitest run components/ui/slider.test.tsx components/player/SeekBar.test.tsx components/player/VolumeControl.test.tsx`: 4 checks fail before (`Expected the element to have accessible name: Seek / Volume`, `aria-valuetext` missing), 16/16 pass after.
- Try it yourself: with VoiceOver/NVDA on, tab to the seek bar on the player; before it said "slider, 25 percent", after it says "Seek slider, 0:30 of 2:00".

**Risk:** low. Both are additive accessibility props; nothing about the slider's visible behavior or drag/commit logic changed.
