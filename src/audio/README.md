# src/audio

Procedural sound via the Web Audio API.

## Responsibility

All game audio: merge and attack cues, UI feedback, ambience, and music. Sound
is **synthesized at runtime** — oscillators, noise, envelopes and filters —
rather than loaded from sample files.

## Why procedural

The portal build budget (≤ 50 MB initial, ≤ 250 MB total, ≤ 1500 files) is
mostly spent on sprites. Synthesized audio costs a few kilobytes of code instead
of megabytes of samples, and it lets pitch and timbre vary with gameplay — unit
tier, merge size, combo count — without shipping variants.

## Rules

- **Browsers block audio until a user gesture.** The context starts suspended
  and resumes on first input; never assume it is running.
- Core drives audio through events, not by importing this folder. Core stays
  silent and browser-free.
- Respect a global mute and volume setting, and honour the portal SDK's mute
  callbacks when the ad frame takes over.
- Reuse audio nodes; creating one per shot at battle tempo will drop frames.
- Nothing here may affect gameplay outcomes.

## Testing

Not a unit-test target. Verify by ear.
