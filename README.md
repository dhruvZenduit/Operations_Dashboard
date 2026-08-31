# Zenduit Operations & Maintenance

A MyGeotab Add-In built as a fleet operations command center, around
**see → understand → investigate → act**.

Four modes: **Overview** (fleet health, telemetry, a ranked Attention Required
worklist, site comparison, fault trend, camera coverage), **Operations** (the
detail behind it — Plan vs Actual against dispatch, DVIR compliance by site,
who is offline right now, camera exceptions), **Maintenance** (condition,
critical faults, inspection defects and the export dialog) and **Safety**
(derived driver scores, a scorecard and events by driver or vehicle). Any asset
row opens a detail drawer without losing your filters.

**Full documentation is in [README.txt](README.txt)** — install steps, the
five-state communication rule, where every number comes from, the required
MyGeotab permissions and the ZenduONE requirements.

## Quick start

```sh
npm install          # once, for the Tailwind build and the tests
npm test             # 144 tests, node --test + jsdom
npm run build:css    # regenerate styles.css after editing src/styles.src.css
python -m http.server
# then open http://localhost:8000/preview.html
```

`preview.html` runs the dashboard from your working copy against sample data.
Opening `index.html` directly pulls the deployed assets instead, because the
Add-In must reference them by absolute URL to work inside MyGeotab.

## Design — ZenduOne light

Light throughout, built on the ZenduOne reference stylesheet: floor `#f2f6fb`,
white panels, brand navy `#092957` / `#0f3d78`, action blue `#1976d2`, ink
`#17243b`, hairline `#e2e8f0`, Segoe UI. Navy is still the brand anchor but no
longer the surface — it survives as the hero and as the deep end of the action
ramp.

**Elevation is a ladder of solid surfaces**, but on light that ladder has only
two real rungs, because nothing is lighter than white: floor `#f2f6fb` → white
panel, with `surface-2` `#f5f8fc` as the *recess* an input or an inset row is
pushed down into. Anything that has to sit above a panel — a popover, a modal, a
toast — stays white and is lifted by `shadow-pop` instead, so on this theme the
shadows carry elevation that the surface steps used to. **Exactly one gradient
survives, and it is the hero's** — `hero-bar` is the only entry in
`backgroundImage`. The page glow and the gradient console and signal bars are
gone; the only other `linear-gradient()`s in the built CSS are the two skeleton
shimmers, which are animation rather than surface and collapse under
`prefers-reduced-motion`.

**If the canonical Zenduit tokens differ, `tailwind.config.js` is the only file
to change** — nothing downstream hardcodes a colour.

**The ramps are ordered by distance from the background, not by darkness.**
`ink-50..300` are surfaces and hairlines, `ink-500..900` are text, `ink-400` is
decorative and non-text only. Semantic ramps match — `good-50` is a light tint,
`good-700` is the dark text on it. That ordering is what let the theme flip
without a single `text-ink-900` or `bg-ink-50` in the markup changing meaning.
Two things did need real edits, and both were structural rather than cosmetic:

- **`brand` was doing two jobs.** On dark it was the green, carrying the action
  colour (focus rings, the primary button, links) *and* "healthy" (dots, bars,
  badges). This palette makes those two different colours, so the green moved
  out to its own `good` ramp and every status consumer was re-pointed at it.
  `brand` is now purely the action blue — and **white sits on the blue fills**
  (5.8:1 on `brand-600`, 4.6:1 on the `-500` hover) where the old green had to
  take navy.
- **The hero did not flip.** It is still a navy gradient, so it is the one
  surface where the semantic ramps still run the other way round: its condition
  pill, its lit lamps and its meter fill take the `-200`/`-300` step, and the
  guard measures them against `instrument.hi` `#18518f` — the light end of the
  gradient, where each of them is at its tightest.

`tests/contrast.test.js` measures **74 token pairs** against WCAG AA — 54 as
text at 4.5:1, 20 as non-text at 3:1 — plus six pairs that must keep *failing*,
and the surface ladder's ordering invariants. It reads the tokens out of
`tailwind.config.js` directly, so changing a colour re-measures every pair it
appears in.

The visual language comes from the world the dashboard describes — gauge
clusters, scan tools, indicator lamps. Two decisions carry it: **all data is set
in mono** (percentages, odometers, durations, fault codes) while labels and
prose stay sans; and **the Fleet Health hero is an instrument panel** — now the
only dark object on the page, carrying the lamp cluster, the deepest shadow and
the only gradient, so there is one unambiguous anchor.

No webfonts — a CSP inside MyGeotab can block an external font host, so both
stacks resolve to faces already on the machine.

## Styling

Tailwind CSS, compiled ahead of time. **Edit `src/styles.src.css`, never
`styles.css`** — the latter is generated by `npm run build:css` and overwritten
on every build. It is committed, so deploys stay a plain static file copy.

Three `tailwind.config.js` settings exist for MyGeotab compatibility, not taste:
`preflight: false` (a global reset would restyle MyGeotab's own chrome),
`important: "#occ-root"` (scopes every utility and beats MyGeotab's tag styles),
and `container: false` (the one utility Tailwind emits unscoped). The `content`
glob must stay `./js/**/*.js` — half the modules live one level down. The
Tailwind CDN script is unusable here: it injects a runtime `<style>` tag, which
MyGeotab strips.

## Layout

```
js/api  →  js/core  →  js/services  →  data-service.js  →  calc.js
        →  ui.js + js/ui/*  →  modes  →  script.js
```

`js/core/*` is pure — no DOM, no API — so every business rule (the five-state
communication status, the group tree, the worklist ranking, the route, DVIR and
safety arithmetic) is testable on its own under `node --test`.
`data-service.js` is the seam that decides mock vs live and normalises both onto
one asset shape, so nothing above it branches on the data source.

Load order in `index.html` is load-bearing and follows those layers: `core/`
before `api/`, `api/` before `services/`, `calc.js` and `icons.js` before
`ui.js`, and `ui.js` before every `ui/*` module and every renderer.

## Data integrity

A value that is not available renders as an explicit *Not available*, *Not
connected* or *Unknown* — never a zero or a dash that could read as one. Open
work orders, maintenance schedules, vendor safety scores and XLSX have no source
in either API and say so. Camera health comes from ZenduONE
`DeviceStatusInfo.cameraStatus`; driver scores are derived from MyGeotab
exception events and trips and carry a *Derived* badge. Fleet Activity uses real
`FaultData` history; historical active/offline is deliberately not plotted,
because MyGeotab reports only current device status.

## Install

Paste `configuration.json` into MyGeotab under
**Administration → System → System Settings → Add-Ins** (with unsigned Add-Ins
allowed). The dashboard appears under **Activity → Operations & Maintenance**.
