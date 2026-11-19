# សំនៀង AI Studio

Khmer-first, mobile-first web app (Next.js + TypeScript) that turns lyrics + a style prompt into a song through a swappable music-provider adapter. UI is fully Khmer/English (toggle in the header, Khmer default).

## Quick start
```bash
cd samnieng-ai-studio
npm install
cp .env.example .env.local      # optional: add ELEVENLABS_API_KEY for live generation
npm run dev                     # http://localhost:3000
```
Without a key the app runs in **clearly labeled DEMO mode**: a ~12–30 s synthesized instrumental placeholder with **no singing**, not derived from your lyrics. It exists so the workflow (progress, playback, history, download, refresh-resume) can be exercised.

Production: `npm run build && npm start` on a **long-running Node host** (jobs run in-process and are stored in `DATA_DIR`; serverless platforms are not suitable without adding a queue/object storage). There is no user auth: run it locally or behind your own access control.

## Provider
`src/lib/providers/` — implement `MusicProvider` (`capabilities()` + `generate()`) and register it in `providers/index.ts`. Shipped: `elevenlabs` (ElevenLabs Music API, `POST /v1/music`, official API; lyrics + composition plan with per-section styles/durations; instrumental via `force_instrumental`) and `demo`.

Every UI control is mapped through `capabilities()` and labeled **Applied / Guidance only / Unavailable / Local only**; each song's card shows what was actually sent ("What was sent").

| Control | ElevenLabs adapter |
|---|---|
| Lyrics, section structure, durations | Applied (lyrics verbatim) |
| Instrumental | Applied |
| Voice direction, per-section male/female/both, pronunciation hints, natural-singing direction, tempo/instruments | **Guidance** (text only; may be ignored) |
| Custom/cloned voice, isolated vocals, stems | **Unavailable** (not implemented; UI hides stem downloads unless a provider returns stems) |

Pronunciation hints are stored separately from lyrics (keyed by exact line text) and only sent if you tick the toggle.

## Honest status
- **Khmer singing quality is unverified.** ElevenLabs does not document Khmer among sung-lyric languages. The adapter's request shapes follow its public docs from memory and were **not run against the live service** (no key/network in the build sandbox). Run `ELEVENLABS_API_KEY=… npm run live-check` and listen before trusting it.
- Sample lyrics (`samples/khmer-sample.json`) were written by an AI; have a native speaker review them.

## Tests
```bash
npm test          # 32 unit + mock-provider tests
npm run build && npm run e2e   # 34 browser checks (Playwright): demo flow, mock-provider failure/retry, missing-credentials
```
`scripts/mock-elevenlabs.mjs` is a local mock, not the real service.

## Environment
See `.env.example`. Keys stay server-side; they are never sent to the browser or stored in job records.
