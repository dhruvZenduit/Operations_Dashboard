/* ============================================================
   tailwind.config.js  —  ZENDUONE LIGHT

   PALETTE SOURCE
   The ZenduOne reference stylesheet:

       --navy    #092957     --good  #16845b / #e7f6ef
       --navy-2  #0f3d78     --warn  #b56b05 / #fff4dd
       --blue    #1976d2     --bad   #c43d3d / #fdeaea
       --blue-2  #3b82f6     --ink   #17243b
       --line    #e2e8f0     --muted #66758d
       --surface #ffffff     --surface-2 #f5f8fc
       page bg   #f2f6fb     --radius 12px
       font: "Segoe UI", Arial, sans-serif

   Navy is still the brand anchor but no longer the surface: it survives
   as the hero and as the deep end of the action ramp. White is the
   panel, #f2f6fb is the floor, and BLUE - not green - is the action
   colour. If the canonical Zenduit design tokens differ from these,
   THIS BLOCK IS THE ONLY PLACE TO CHANGE - nothing downstream
   hardcodes a colour.

   -- WHAT THE LIGHT PASS CHANGED ---------------------------------
   Every ramp here is ordered by DISTANCE FROM THE BACKGROUND, not by
   darkness. That is what let the theme flip without touching a single
   `text-ink-900`, `bg-ink-50` or `border-ink-200` in the markup:

       ink-50 .. ink-300    surfaces, fills and hairlines (light)
       ink-400              decorative only - fails text contrast
       ink-500 .. ink-900   text, quiet to loud (dark)

   The semantic ramps follow the same rule inverted back: good-50 is a
   light tint you put behind text, good-700 is the dark text you put
   on it.

   Two things did need edits downstream, and both are structural rather
   than cosmetic:

     1. `brand` was the green and was doing two jobs - action AND
        "healthy". This palette makes those different colours, so the
        green moved out to its own `good` ramp and every status
        consumer was re-pointed at it. `brand` is now purely the
        action/affordance blue.
     2. `surface-2` flipped from "the step above the card" to "the
        recess below it", because nothing is lighter than white. The
        popovers that relied on it moved to `bg-surface` + shadow-pop.

   THREE SETTINGS ARE LOAD-BEARING FOR MYGEOTAB, not preferences -
   preflight / important / container. See the notes on each.

   Build:  npm run build:css   (or watch:css while editing)
   Output: styles.css, COMMITTED so deployment stays build-free.
   ============================================================ */
module.exports = {
  content: [
    "./index.html",
    "./preview.html",
    "./script.js",
    "./js/**/*.js"
  ],

  corePlugins: {
    /* Preflight is a GLOBAL element reset. An Add-In renders inside
       MyGeotab's own page, so a global reset would restyle MyGeotab's
       chrome around us. The resets we DO need are scoped under
       #occ-root in src/styles.src.css instead. */
    preflight: false,
    /* `container` is the one utility Tailwind emits UNSCOPED even with
       `important` set, so it would escape into MyGeotab - where other
       stylesheets on the page are very likely to use `.container`. */
    container: false
  },

  /* Emits every utility as `#occ-root .foo`. Nothing leaks out of the
     Add-In, and the extra specificity beats MyGeotab's framework styles
     on bare table/button/input/h1 tags without needing !important. */
  important: "#occ-root",

  theme: {
    extend: {
      /* ---- The responsive ladder ------------------------------
         Three steps, and the utility breakpoints have to name the same
         three or the markup can open a fourth. `lg` is repointed from
         Tailwind's 1024 to 1180 - the single desktop breakpoint the
         whole layer in src/styles.src.css switches on - because the two
         `lg:block` dividers in the console rail were otherwise the only
         thing on the page still changing at 1024, which is exactly the
         dead band Phase 10 closed.

             sm  640   phone -> tablet (drawer stops being a sheet)
             md  768   metric rail 2-up -> 3-up (a column count only)
             lg 1180   the desktop layout

         xl / 2xl are left at their defaults and unused. */
      screens: {
        lg: "1180px"
      },

      colors: {
        /* ---- Surfaces -------------------------------------------
           THE LADDER, floor first. On a light theme "raised" means
           LIGHTER, so the ladder runs the opposite way it did on dark -
           and it runs out of room, because nothing is lighter than
           white:

               page       #f2f6fb   the floor
               console    #ffffff   the chrome shell (identity + rail)
               surface    #ffffff   cards and panels
               surface-2  #f5f8fc   RECESS - inputs, inset rows, heads
               surface-3  #ffffff   LIFTED - active segment, toast
               instrument navy      the hero, the one dark object left

           Two rungs changed direction, deliberately:

           surface-2 was the step ABOVE the card on dark (popovers,
           drawer head). White has no step above it, so on light the
           elevated things stay white and are lifted by `shadow-pop`
           instead, and surface-2 becomes the RECESS an input or an
           inset row is pushed down into. The three popovers that used
           it moved to `bg-surface` in styles.src.css.

           surface-3 is white, the same value as `surface`, and is kept
           as its own token because its consumers mean "lifted clear of
           the track it sits in" - .occ-seg.is-active on its bg-ink-50
           rail, .occ-toast. Here the shadow carries that distinction;
           on a dark flip the colour would carry it again.

           Object form, not a bare string: styles.src.css resolves it
           as theme("colors.page.DEFAULT"). */
        page: { DEFAULT: "#f2f6fb" },

        /* The chrome shell: identity row + control rail, one white
           object lifted off the page by a hairline and shadow-shell.
           `rail` is the recessed control strip inside it - one step
           DOWN now, so the ladder still never doubles back.

           NOTE: the reference stylesheet paints its top bar navy and
           its control bar white. Here both live inside .occ-console,
           and that shell holds every form control on the page, so it
           takes the light treatment as one object. Brand identity is
           carried by the hero, the blue brandmark and the 1px blue
           hairline on the shell's top edge instead. */
        console: {
          DEFAULT: "#ffffff",
          rail:    "#f5f8fc"
        },
        surface: {
          DEFAULT: "#ffffff",   /* cards, panels, popovers            */
          2: "#f5f8fc",         /* recess: inputs, inset rows, heads  */
          3: "#ffffff"          /* lifted: active segment, toast      */
        },

        /* The hero, straight off the reference `.hero-card`: a navy
           gradient with light text. This is why the instrument-* tokens
           exist, and it is the only place they apply - so it is also
           the only part of the page that did NOT flip.
           Ratios below are against the DARK end, #0a2d60. */
        instrument: {
          DEFAULT: "#0a2d60",   /* the DARK end of hero-bar           */
          /* The LIGHT end of hero-bar. Not used as a background by
             anything - it exists so the contrast guard can measure
             everything painted on the hero against the tightest point
             of the gradient rather than the flattering one. Keep the two
             in step with the `hero-bar` gradient below. */
          hi:      "#18518f",
          surface: "#092957",   /* inset footer strip - brand navy    */
          rule:    "#1f4a80",
          ink:     "#ffffff",
          ink2:    "#dbe8f7",   /* 10.9:1 - the reference's hero copy */
          /* Unlit lamp ring - a non-text UI edge, so it is held to the
             3:1 bar, not 4.5:1. Measured against the LIGHT end of the
             gradient (#18518f), where it is tightest: 3.3:1. */
          ink3:    "#8fa9c9"
        },

        /* ---- Neutrals (navy-tinted, and the right way up again) ----
           On dark these ran inverted - ink-50 was a dark fill, ink-900
           was near-white. Ordered by distance from the background in
           both themes, so flipping the theme flipped the values and
           left every consumer semantically correct.
           Ratios are against white. */
        ink: {
          50:  "#f6f9fc",   /* subtle fill, row hover               */
          100: "#eef3f9",   /* stronger fill, soft rule             */
          200: "#e2e8f0",   /* hairline border      (--line)        */
          300: "#cbd6e4",   /* stronger border, decorative glyph    */
          400: "#8492a8",   /* DECORATIVE / non-text only - 3.2:1   */
          500: "#62718a",   /* small informational text - 4.9:1     */
          600: "#4a5a72",   /* body text                - 7.0:1     */
          700: "#33445e",   /* strong body              - 9.9:1     */
          800: "#24344c",   /*                          - 12.6:1    */
          900: "#17243b"    /* headings, primary text   - 15.5:1    */
        },

        /* ---- Accent: action blue -------------------------------
           The reference stack's --blue, and the token that carried the
           one real conflation in the dark theme: `brand` was the green
           and was doing BOTH jobs - focus rings, the primary button and
           links on one hand, "healthy" dots and bars on the other.
           Those are two different colours in this palette, so the green
           moved out to `good` below and this ramp is now purely the
           action/affordance accent.

           500/600 are FILLS and take WHITE text (4.6:1 on 500,
           5.8:1 on 600). 700+ are the dark blues for TEXT on white.
           200 is the on-navy step, for a link on the hero.
           Ratios against white unless stated. */
        brand: {
          50:  "#eaf2fd",   /* tint: selected row, chip, badge      */
          100: "#d8e8fb",   /* selected row hover                   */
          200: "#b6d3f6",   /* text ON the hero - 5.2:1 there       */
          300: "#7fb0ea",   /* border on a tint, underline          */
          400: "#3b82f6",   /*                      (--blue-2)      */
          500: "#1976d2",   /* fills, dots, focus ring  (--blue)    */
          600: "#1565c0",   /* primary button fill                  */
          700: "#14549e",   /* action link, eyebrow     - 7.5:1     */
          800: "#0f3d78",   /* link hover           (--navy-2)      */
          900: "#092957"    /* deepest              (--navy)        */
        },

        /* ---- Good / healthy ------------------------------------
           Split out of `brand` in the light pass. 500 is the fill
           (--good); 700 is the text, because 500 measures only 4.2:1
           on its own tint - the reference has that same gap. */
        good: {
          50:  "#e7f6ef",   /* tint bg              (--good-bg)     */
          100: "#d3efe2",
          200: "#a9dfc7",   /* border on the tint                   */
          300: "#6cc79f",
          400: "#2ba375",
          500: "#16845b",   /* fill: dots, bars, rails   (--good)   */
          600: "#12724e",   /* value text                - 5.9:1    */
          700: "#106a49",   /* text on white 6.6:1, on -50 5.9:1    */
          800: "#0c5238",
          900: "#08402c",
          /* Lit indicator ON A CARD. A lamp has to work on white now,
             so it is a mid-tone - which means it does NOT work on the
             navy hero (1.7:1 there). The hero takes the -300/-200 step
             instead, scoped in styles.src.css. Same for amber and red. */
          lamp: "#16845b"
        },

        /* ---- Caution / critical / info -------------------------
           Same rule: -50 is a light tint, -600/700 is the dark text
           you put on it. */
        amber: {
          50:  "#fff4dd",   /* tint bg              (--warn-bg)     */
          100: "#ffe9bd",
          200: "#f6d497",
          300: "#e8b158",
          /* The reference --warn #b56b05 measures 4.1:1 on white and
             3.8:1 on its own tint - it fails AA as text at any size
             below large. It survives here as the hue: -500 is the
             graphic fill (3.4:1, clears the 3:1 non-text bar) and -600
             is that hue one step down, so a KPI value or a chip label
             clears 4.5:1 at any size. */
          500: "#c47a05",   /* fill: bars, rails         - 3.4:1    */
          600: "#a06005",   /* value text                - 5.0:1    */
          700: "#8d5304",   /* text on white 6.2:1, on -50 5.7:1    */
          900: "#5c3602",
          lamp: "#c47a05"
        },
        red: {
          50:  "#fdeaea",   /* tint bg              (--bad-bg)      */
          100: "#fbd5d5",
          200: "#f2b4b4",
          500: "#d94a4a",   /* fill: bars, rails         - 4.2:1    */
          600: "#c43d3d",   /* value text  (--bad)       - 5.1:1    */
          700: "#a32a2a",   /* text on -50               - 6.2:1    */
          900: "#6e1b1b",
          lamp: "#d94a4a"
        },
        /* Info. The reference has no dedicated info colour, so this is
           its --blue-2 family: deliberately ADJACENT to the action blue
           rather than distinct from it. That is only safe because no
           info state is carried by colour alone - every one of them
           ships a word and an icon (see STATUS_BADGE in js/ui.js). */
        sky: {
          50:  "#eef4ff",
          100: "#dbe8fe",
          200: "#bfd7fd",
          500: "#3b82f6",   /* fill                 (--blue-2)      */
          600: "#2563eb",   /* info lamp                 - 5.2:1    */
          700: "#1d4ed8",   /* info text                 - 6.7:1    */
          900: "#172f7a"
        }
      },

      fontFamily: {
        /* Segoe UI first, matching the ZenduOne v1 stack and the
           Windows machines this is read on. */
        sans: [
          "Segoe UI", "Inter", "ui-sans-serif", "system-ui",
          "-apple-system", "BlinkMacSystemFont", "Roboto",
          "Helvetica Neue", "Arial", "sans-serif"
        ],
        /* Readouts. No webfont: an Add-In runs inside MyGeotab's page,
           where an external font host is one more thing a CSP can
           block, so this resolves to faces already on the machine. */
        mono: [
          "ui-monospace", "SF Mono", "SFMono-Regular", "Cascadia Mono",
          "Segoe UI Mono", "Roboto Mono", "Menlo", "Consolas", "monospace"
        ]
      },

      /* ---- Type scale -------------------------------------------
         A gauge cluster needs a WIDE scale, not an even one: the
         primary readout has to outweigh a section title by a factor,
         or the page flattens into "everything is a heading". Six
         numeric steps, four text steps, nothing in between. */
      fontSize: {
        "readout-2xl": ["54px", { lineHeight: "0.95", letterSpacing: "-0.035em", fontWeight: "600" }],
        "readout-xl": ["40px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "600" }],
        "readout-lg": ["26px", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "600" }],
        "readout-md": ["19px", { lineHeight: "1.1", letterSpacing: "-0.015em", fontWeight: "600" }],
        "readout-sm": ["15px", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "600" }],
        label:  ["10px", { lineHeight: "14px", letterSpacing: "0.09em", fontWeight: "600" }],
        /* Wider tracking than `label`, for the one-per-panel eyebrow. */
        eyebrow: ["10px", { lineHeight: "14px", letterSpacing: "0.14em", fontWeight: "600" }],
        "2xs":  ["10.5px", { lineHeight: "14px" }],
        data:   ["12px", { lineHeight: "16px" }]
      },

      borderRadius: {
        /* 10px, from the ZenduOne --radius token. */
        panel: "10px",
        hero:  "12px",
        /* The console shell wraps the panel radius, so it needs one step
           more to avoid the concentric-corner tangent. */
        shell: "14px"
      },

      boxShadow: {
        /* On light, elevation IS the shadow: the surface ladder has only
           two real rungs (grey floor, white panel) and cannot carry it
           the way the dark ladder did. So these get actual work to do,
           and they are the reference stack's own values - a
           near-invisible lift on a card, one broad soft drop on the hero
           and on anything that floats. All navy-tinted
           rgba(18, 43, 78, *) rather than black, so a shadow stays in
           the same family as the page it falls on. */
        panel: "0 2px 8px 0 rgba(18, 43, 78, 0.045)",
        hero:  "0 8px 26px 0 rgba(18, 43, 78, 0.08)",
        pop:   "0 10px 28px -6px rgba(18, 43, 78, 0.16)",
        tab:   "0 1px 2px 0 rgba(18, 43, 78, 0.08)",
        /* The console shell is the outermost object on the page and the
           only one that casts a shadow this broad. The inset hairline is
           now a white catch on the top edge, where on dark it was a pale
           blue at .06.
           There is deliberately no `glow-*` step and no `lamp` step in
           here: nothing on this page emits light. A lit lamp carries a
           2px ring written inline in styles.src.css, which is a hairline
           of colour, not a halo. */
        shell: "0 1px 0 0 rgba(255, 255, 255, 0.9) inset, " +
               "0 8px 26px -14px rgba(18, 43, 78, 0.16)"
      },

      /* ---- Gradients -------------------------------------------
         EXACTLY ONE, and it is the hero's. "Dark command center, not
         cyberpunk": everything else on the page is a solid step on the
         surface ladder (page -> console -> card -> hero), lifted by a
         hairline and one shadow step rather than by a light pool.
         Removed in the Phase 10 token pass: `brand-bar` (its only
         consumer, .occ-brandbar, was dead), `console-bar` (now the
         solid `console` colour), `signal-bar` (now the solid card
         `surface`) and `page-glow` (two radial pools on #occ-root). */
      backgroundImage: {
        "hero-bar": "linear-gradient(125deg, #0a2d60 0%, #18518f 100%)"
      },

      transitionTimingFunction: {
        out: "cubic-bezier(0.22, 1, 0.36, 1)"
      },

      keyframes: {
        "pop-in": {
          from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
          to:   { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to:   { backgroundPosition: "200% 0" }
        },
        /* The ONE looping animation on the page, and it is 2px of ring on
           a 6px dot. A control room that pulses everywhere is a control
           room nobody can read an alarm in. */
        "live-ring": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(22, 132, 91, 0.40)" },
          "55%":      { boxShadow: "0 0 0 4px rgba(22, 132, 91, 0)" }
        }
      },

      animation: {
        "pop-in": "pop-in 150ms cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer:  "shimmer 1.6s linear infinite",
        "live-ring": "live-ring 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite"
      }
    }
  },

  plugins: []
};
