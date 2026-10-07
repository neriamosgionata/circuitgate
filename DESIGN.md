---
name: CircuitGate
description: Browser circuit editor and simulator with a pinned-worktable interface.
colors:
  board: "#b9a482"
  board-deep: "#a08c6d"
  sheet: "#e7e3d9"
  sheet-raised: "#efece3"
  sheet-sunk: "#dcd7ca"
  ink: "#1d1d1b"
  ink-soft: "#4a463f"
  highlight: "#ffe23d"
  stamp-red: "#c0271b"
  stamp-green: "#1f6b43"
  biro: "#1d4ed8"
  biro-soft: "#6b8ce8"
typography:
  head:
    fontFamily: "Saira Condensed, 'Arial Narrow', sans-serif"
    fontWeight: 600
    letterSpacing: "0.01em"
  body:
    fontFamily: "'Public Sans', system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.45
  mono:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "13px"
rounded:
  sm: "2px"
  md: "3px"
spacing:
  sm: "6px"
  md: "10px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-primary-hover:
    backgroundColor: "{colors.biro}"
    textColor: "#fff"
  button:
    backgroundColor: "{colors.sheet-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  button-danger:
    backgroundColor: "{colors.sheet-raised}"
    textColor: "{colors.stamp-red}"
  input:
    backgroundColor: "{colors.sheet-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "5px 8px"
  nav-link-active:
    backgroundColor: "{colors.highlight}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.sheet-raised}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px"
---

# Design System: CircuitGate

## Overview

**Creative North Star: "The Pinned Worktable"**

The interface is a departmental worktable: kraft board under everything, copy-paper sheets pinned on top for each panel, toner text, biro links, highlighter for whatever the user touched, and rubber stamps for whatever ran. Exact and unhurried: plain, exact, and fast copy; nothing cute, nothing that slows a lab session; it reads as physical working material, not software chrome. The system deliberately refuses the category defaults — no dark IDE chrome, no grey-plus-blue SaaS softness, no gamified states, no rounded card grids.

**Key Characteristics:**
- Sheets and strips, never cards and heroes: every surface is a pinned sheet with a ruled head.
- Marks over chrome: selection is a highlighter wash, outcomes are stamps.
- Density with intent: packed modules and small mono values, each with a ruled header.
- Ink on paper, everywhere: toner text, biro action color, red for void, green for pass.

## Colors

Paper and ink with three working colors that each do a named job.

### Primary
- **Toner Ink** (#1d1d1b): primary text, sheet borders, button ink. The voice of the sheet itself.
- **Kraft Board** (#b9a482, deep #a08c6d): shell ground and the app rail. The worktable everything is pinned to.

### Secondary (optional; omitted — the system has three working accents, not a hue wheel)

### Tertiary (optional; omitted)

### Neutral
- **Copy Paper** (#e7e3d9): sheet ground; raised #efece3 for fields, sunk #dcd7ca for plot wells.
- **Ink Soft** (#4a463f): secondary text, captions, rail labels. Body and placeholder text floor.
- **Rule Greys**: hairline #8a8377, faint #bbb3a3 (rules and fills only, never text).

### Named Rules (optional, powerful)
**The Three-Jobs Rule.** Color has exactly three jobs: highlighter (#ffe23d) marks what the user touched; stamp red (#c0271b) voids what failed; stamp green (#1f6b43) passes what succeeded; biro (#1d4ed8) is the only action blue for links, selection geometry, and wires. Nothing else gets a color.
**The Marked-Surface Rule.** A highlight wash or stamp always pairs with a text label or value; color is never the only carrier of state.

## Typography

**Display Font:** Saira Condensed (with Arial Narrow), 500–700, for sheet heads, stamps, nav, and button labels — always uppercase with tracked spacing.
**Body Font:** Public Sans (with system-ui), 400/600/700, 14px/1.45, for prose, captions, and panel copy.
**Label/Mono Font:** Courier Prime (with Courier New), tabular numerals, for values, voltages, currents, IDs, node names, and every editable number.

**Character:** Condensed bureaucratic heads over plain instructional prose, with typewriter values wherever a number must be trusted.

### Hierarchy
- **Display** (Saira Condensed 600, 26–30px, 1.1): page titles only (Projects, Teams, Account).
- **Headline** (Saira Condensed 600, 20px): sheet heads and auth titles.
- **Title** (Saira Condensed 600, 14–16px, tracked): panel and legend headings.
- **Body** (Public Sans 400, 14px, 1.45): prose and help copy.
- **Label** (Saira Condensed 600, 11–12px, 0.08–0.12em tracking, uppercase): field labels, legend captions, button text, stamps.

### Named Rules (optional)
**The Case-Carries-Rank Rule.** Rank is carried by case, weight, and rules — never by a new size alone. Sheet heads stay one size.

## Layout

The app is a board with pinned sheets: a kraft board rail header, full-bleed content ground in board, and paper sheets for every panel and strip. Dashboard pages center at 1080px with clamped side padding; the editor fills the viewport with three pinned panes (parts sheet, canvas sheet, spec slip) and an analysis strip pinned below. Corners are square (2–3px) everywhere; hairlines separate, never enclose, except sheet borders. At 390px the rail wraps, dashboard strips stack, and the editor scrolls with a 420px minimum canvas.

## Elevation & Depth

Flat paper with one offset: sheets sit on the board with a 1px ink-foot plus a 3–6px soft ink shadow (`0 1px 0 rgba(29,29,27,0.18), 0 3px 6px rgba(29,29,27,0.12)`). No bevels, no glows.

### Shadow Vocabulary (if applicable)
- **Pinned sheet** (`box-shadow: 0 1px 0 rgba(29,29,27,0.18), 0 3px 6px rgba(29,29,27,0.12)`): every sheet, panel, card, and dialog.
- **No shadow** tape corners, text, rules, canvas drawings.

### Named Rules (optional)
**The Flat-By-Default Rule.** Surfaces are flat at rest; the single shadow vocabulary exists only to separate a sheet from the board.

## Shapes

Form language is rectilinear paper: 2–3px corners, 1px hairline rules, 2px ink rule under headers and toolbars, 5px highlighter underline for active navigation and brand marks. Selection geometry is drawn, not boxed: the canvas marquee is biro, and selection carries a 2px highlight halo. Stamps rotate −2deg with a 2–3px border. No circles except pins and the round recording-style dots; no pill radii anywhere — chips are 2px rectangles.

## Components

### Buttons
- **Shape:** 2px corners, 1px ink-ish border with a 2px bottom rule (stapled strip).
- **Primary:** toner fill (#1d1d1b) with sheet text; turns biro on hover.
- **Hover / Focus:** paper-wash hover (`--highlight-soft`); one visible 2px biro focus ring everywhere.
- **Secondary / Ghost / Tertiary (if applicable):** the default strip (paper fill, ink text); danger uses stamp-red ink and border. Disabled greys on sunk paper.

### Chips
- **Style:** transparent paper, 1px rule border, condensed caps label.
- **State:** domain chips take the domain ink (biro for analog); stamped state chips (shared, lock) keep the stamp border.

### Cards / Containers
- **Corner Style:** 2px. **Background:** copy paper (raised paper for sub-boxes). **Shadow Strategy:** the pinned-sheet vocabulary. **Border:** 1px rule. **Internal Padding:** 10px strips, 12–16px cards.

### Inputs / Fields
- **Style:** raised-paper field, 1px rule, 2px radius, mono values; checkbox uses biro accent.
- **Focus:** biro border shift. **Error / Disabled:** stamp-red text and message; disabled sits on sunk paper.

### Navigation
- Board rail, condensed caps labels; hover underlines in highlighter; active page carries the highlighter wash; email shown in mono; Log out is a stapled strip button. Rail wraps on narrow screens.

### Signature Component (optional, if the project has a distinctive custom component worth documenting)
**Stamp.** A rotated (−2deg) double-weight bordered label: green PASS, red VOID, ink-muted neutral. Run outcomes, lock states, and saved states stamp the sheet and persist until the next event; nothing disappears, it cancels. The run press animates in two 140ms steps (none under reduced motion).

## Do's and Don'ts

### Do:
- **Do** mark touched things with highlighter and run things with stamps — marks over chrome, always.
- **Do** set every value, ID, voltage, and current in Courier Prime with tabular numerals.
- **Do** keep sheets on the board ground with the pinned-sheet shadow; the app background is never white.
- **Do** give every empty, loading, error, stale, locked, and read-only state its own stamped or ruled message.

### Don't:
- **Don't** use the dark-IDE palette, grey-plus-blue SaaS accents, or rounded card grids.
- **Don't** add a UI framework, icon system, or hosted font; faces are self-hosted woff2 beside the app.
- **Don't** use color alone for state; every wash and stamp pairs with text.
- **Don't** let a paper effect (tape, rotation, texture) cost legibility or speed; flat paper wins ties.
