---
name: CircuitGate
description: Browser circuit editor and simulator presented as a modern drafting sheet.
colors:
  ground: "#eef1f3"
  ground-deep: "#e4e9ec"
  paper: "#ffffff"
  paper-soft: "#f7f9fa"
  paper-sunk: "#edf1f3"
  ink: "#101820"
  ink-soft: "#46525d"
  ink-faint: "#66737e"
  rule: "#d9e0e5"
  rule-strong: "#b4c0c8"
  shell: "#0f1923"
  shell-raised: "#16232f"
  shell-ink: "#e9eff4"
  accent: "#1858c9"
  accent-strong: "#0f449c"
  accent-soft: "#e7effc"
  analog: "#a84a00"
  ok: "#0c7a4e"
  warn: "#8f5b00"
  danger: "#bf2b1f"
typography:
  ui:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontWeight: 400
    fontSize: "15px"
    lineHeight: 1.5
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontWeight: 650
    letterSpacing: "-0.025em"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace"
    fontSize: "12px"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "28px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 13px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "7px 13px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px"
  chip:
    backgroundColor: "{colors.paper-soft}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
  rail:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-ink}"
---

# Design System: CircuitGate

## Overview

**Creative North Star: "The Drafting Sheet"**

CircuitGate is a technical drawing sheet on a dark bench. The ground is a faint
engineering grid; every project, panel, and editor surface is white paper with a
title block that carries the real metadata of what is on it. The shell is a dark
ink rail, the interaction accent is drafting blue, and every number is set in
mono. The product should read as a precise instrument that a student can hand to
a classmate, not as a generic dashboard and not as a retro paper prop.

**Key Characteristics:**
- Sheets with title blocks, not cards with decoration: metadata lives in ruled
  cells labelled Updated, Revision, Domain, Components, Link.
- One accent for action and one for analog. Blue means "do it here"; warm ochre
  is reserved for analog domain identity.
- Dense but calm: hairline rules, small tracked labels, generous page margins.
- Real information replaces ornament: figure callouts on auth, waveform and
  netlists in the editor, measured values in mono.
- Auth is a split board: a dark drawing sheet carrying the value proposition and
  a figure, with the form on white paper.

The system deliberately refuses the dark-IDE editor look (the dark surface is
navigation chrome only), grey-plus-blue SaaS dashboard softness, gamified state,
and decorative paper textures that cost legibility.

## Colors

Paper, graphite, drafting blue, and a dark rail. State colors are semantic and
always paired with a label.

### Primary
- **Ink (#101820):** primary text and the editor's circuit drawing.
- **Drafting Blue (#1858c9):** primary action, links, selection, focus, current
  navigation. Hover darkens to #0f449c; washes use #e7effc.
- **Bench (#0f1923):** the fixed navigation rail, auth figure panel, and
  `theme-color`. Not a content background.

### Secondary
- **Analog Ochre (#a84a00):** analog domain chips, analog part glyphs, and
  analog-only affordances. Paired with a text label, never color alone.

### Neutral
- **Ground (#eef1f3):** page ground with a 32px engineering grid at 3.2% ink.
- **Paper (#ffffff) / Paper Soft (#f7f9fa) / Paper Sunk (#edf1f3):** sheets,
  alternating rows, wells and disabled fields.
- **Ink Soft (#46525d) / Ink Faint (#66737e):** secondary and tertiary text.
- **Rule (#d9e0e5) / Rule Strong (#b4c0c8):** hairlines and control borders.

### State
- **Ok (#0c7a4e, soft #e3f4ec):** completed runs, live connection, saved state.
- **Warn (#8f5b00, soft #fdf3dd):** read-only locks, shared-with-you, stale
  results, analog identity.
- **Danger (#bf2b1f, soft #fcebe9):** compile and solver failures, destructive
  actions, lost locks.

### Named Rules
**The Three-Jobs Rule.** Blue is action and interaction; ochre is analog
identity; red is failure, green is success. Nothing else carries a hue.

**The Title-Block Rule.** Metadata is never loose text. Group it into a
`.titleblock` with tracked labels and mono values.

## Typography

**UI / Display Font:** Archivo (self-hosted variable woff2), weights 400–700.
Headings at 650 with tight tracking; UI labels at 600; body at 400.
**Mono Font:** JetBrains Mono (self-hosted variable woff2) for every value,
identifier, timestamp, net name, measurement, and code sample. Tabular numerals.

**Character:** A drawing-office sans with technical mono annotations. No display
serif, no condensed bureaucratic capitals, no system font as the voice.

### Hierarchy
- **Display** (Archivo 650, 26–34px, −0.025em): page titles and project names.
- **Headline** (Archivo 650, 19px): sheet titles in dialogs and empty states.
- **Title** (Archivo 650, 14–15px): card and project names.
- **Label** (Archivo 650, 10–11px, 0.09em, uppercase): sheet heads, title-block
  labels, field labels, rail section labels.
- **Body** (Archivo 400, 14–15px, 1.5): prose, help, empty states.
- **Value** (JetBrains Mono 400–600, 11–13px): IDs, versions, dates, counts,
  voltages, currents, node names, simulation tick.

## Layout

A fixed 224px dark rail on the left holds the brand, primary navigation, and the
signed-in account block at the bottom. Content sits in a `.page-frame` capped at
1200px with 18–40px side padding. Dashboards use a main column plus a 320px
action rail (projects) or a 340px list beside a detail sheet (teams). The editor
is a three-pane grid: 244px components sheet, fluid canvas, 300px inspector,
with the simulation or analysis sheet docked under the canvas. At 1080px the
editor stacks palette → canvas → inspector and the page scrolls; at 900px the
rail becomes a horizontal top bar, and below 560px its labels collapse to icons.

Sheets use 6px radius, 1px rules, and a single small shadow. The page head is
type and spacing only, with no heavy rule; the dark rail provides the frame.
Auth is a 1:1 split at desktop: dark figure panel left, form sheet right; under
900px the figure panel collapses to the wordmark and the form centers.

## Elevation & Depth

Depth is reserved for sheets above the ground.

- **Sheet** (`0 1px 2px rgba(16,24,32,.06)`): all cards, panels, dialogs.
- **Lift** (`0 6px 18px -10px rgba(16,24,32,.28), 0 1px 3px rgba(16,24,32,.08)`):
  hovered project sheets and raised dialogs.
- **No shadow** on rail, rules, canvas drawings, or inline strips.

## Components

### Buttons
- **Shape:** 4px radius, 1px Rule Strong border, paper fill, 34px min height.
- **Primary:** drafting blue fill with white text and a small blue shadow.
- **Hover / Focus:** paper-soft hover; 2px focus ring in `--focus` with 2px
  offset. Active press translates 1px.
- **Secondary / Ghost / Danger:** ghost is borderless and quiet; danger uses red
  ink and border with a red wash on hover. Disabled uses sunk paper and faint
  ink.

### Chips and stamps
- **Chip:** 3px radius, 1px rule, tracked 10.5px label. Domain logic uses blue
  wash, analog uses ochre wash, shared uses warn wash.
- **Stamp:** status chip with a 5px round dot before the label; green for
  pass/live/saved, red for failure/void, muted for unknown. The only authored
  motion is the 180ms stamp press.

### Sheets and title blocks
- **Sheet:** paper, 1px rule, 6px radius, sheet head (42px, uppercase tracked,
  optional mono note on the right).
- **Title block:** flex row of cells divided by rules; each cell is a tracked
  label over a mono value; the first cell grows. Used on projects, the editor
  sheet strip, and account metadata.

### Inputs / Fields
- **Style:** paper fill, 1px Rule Strong, 4px radius, 36px min height. Selects
  carry an authored chevron. Focus replaces the border with a 3px accent-soft
  ring.
- **Errors:** danger-soft block with red text; inline field errors sit in the
  danger ink.
- **Disabled:** sunk paper and faint ink.

### Navigation
- Dark rail: 224px, brand mark plus "logic + analog", icon plus label links.
  Active is an accent-filled row with white text and `aria-current="page"`.
  Bottom account block shows initials, truncated email, and Log out.
- Mobile: rail becomes a 52px top bar with the brand, icon nav, and Log out.
- Skip link is the first focusable element.

### Signature Components
**Title block.** The recurring metadata strip; it makes a project or document
feel like a drawing with provenance, and removes the need for decorative cards.
**Drafting figure.** Auth and empty states use authored line drawings of gates,
waveforms, and dividers with FIG labels, never stock imagery.

## Do's and Don'ts

### Do:
- **Do** put metadata in title blocks and values in JetBrains Mono.
- **Do** keep the ground a faint grid and the shell dark; content is white paper.
- **Do** pair every colored state with a readable label and a dot or chip.
- **Do** let the canvas and waveform be the visual center on editor pages.
- **Do** give loading, empty, error, read-only, stale, and locked states their
  own composed treatment; skeletons for lists, teaching empty states.

### Don't:
- **Don't** bring the dark bench into content panels or return to a dark IDE.
- **Don't** use purple/indigo gradients, glassmorphism, or soft-shadow cards.
- **Don't** use color alone for domain, status, or validation.
- **Don't** add a UI framework, icon library, or hosted fonts; icons are authored
  SVG and faces are self-hosted.
- **Don't** make the paper metaphor decorative at the cost of density or speed.
