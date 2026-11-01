# Pitchside

A browser-based football career simulator. You control one footballer from sixteen to retirement: a hidden potential, 32 attributes,
a fictional world of clubs and nations, and a deterministic simulation underneath it all. Everything runs locally; saves live in your
browser's IndexedDB. All names, clubs, crests and nations are invented.

## Run it

```bash
npm install
npm run dev          # development server
npm run build        # typecheck + production build
npm run preview      # serve the production build on :4173
npm test             # 187 Vitest tests (engine, competitions, transfers, saves, the 17-step career journey)
```

Browser audits (need `playwright` and `axe-core` installed, and the preview server running):

```bash
npm run audit:a11y           # axe-core WCAG 2.0/2.1 A+AA on every screen, desktop and phone, with the accessibility switches on
npm run audit:keyboard       # tab order, focus rings, dialog focus trap, Escape, system reduced-motion
npm run audit:transfer-flow  # drives the real screens: play on, receive a bid, negotiate, accept, check the move
```

## How it is built

- **Stack:** React 19, TypeScript, Vite, Tailwind 4, Zustand. No server.
- **`src/engine`** is plain TypeScript with no UI imports. State is one JSON object (`GameState`); every random draw comes from a seeded
  generator (mulberry32), and a match is seeded from `(career seed, simulation version, fixture id)`. The same seed gives the same
  result whether a match is played instantly, as live text or as the 2D view: they are three presentations of one event stream.
- **`src/persistence`** holds the versioned save envelope (schema version, migrations, validation), IndexedDB slots, autosave and
  JSON export/import. A corrupt or too-new file is rejected with a reason instead of loading partially.
- **`src/store`, `src/ui`** are the screens (home, match day, live match, my player, matches, club, training, transfers, competitions,
  national team, life, news, career history, settings) over the engine. Every button calls an engine function and shows its result.

## What is in the game

| Area | What it does |
| --- | --- |
| Career creation | Four pathways (youth prospect, lower-league, established, custom), ten positions, personality, three difficulties (Casual, Standard, Simulation), a seed. |
| Player | 32 attributes, a position-weighted overall, a hidden potential, gradual progression with a stated reason for every change, fatigue, sharpness, form, morale, injuries. |
| Matches | Event-driven engine: lineups, tactics, shots, cards, injuries, substitutions, extra time, penalties, ratings, player of the match, commentary. |
| World | 32 clubs in two divisions (3 up, 3 down), a domestic cup, managers, squads that turn over, 16 nations with call-ups, qualifiers and a tournament every other summer. |
| Money and moves | Contracts with bonuses and release clauses, windows, offers (permanent, loan, free, pre-contract, extension), negotiation, an agent, and an auditable ledger with wages, tax, living costs and one-off payments paid exactly once. |
| Life | Purchases, investments, relationships, decisions with consequences, reputation. |
| After the pitch | News, awards, achievements, retirement conversations, legacy summary, career history. |
| Accessibility | Larger text, high contrast, reduced motion (also follows the system setting), keyboard navigation, skip link, focus rings, labelled controls. |

## Honest status

Fully built and covered by tests: the player model and progression, the match engine, competitions and the calendar, transfers and
contracts, finance, life events, retirement and legacy, international football, saves (round trip, refresh, import validation,
migration), and the 17-step journey from the brief, driven only through engine calls the screens make.

Built but only partly verified: the 2D match view and sound are exercised by smoke runs rather than assertions; a career's save reaches
roughly 5 to 8 MB after several seasons (older seasons are pruned at each rollover, history and records are kept); long careers beyond
the tested soak runs have not been profiled for potential drift.

Partial by design: sound is a set of synthesised cues in live matches only; seasons spent abroad are simulated as a summary rather
than match by match.

Not built: continental or other club competitions beyond the league pyramid and the domestic cup, and the optional Supabase cloud
save (saves are local and exportable).
