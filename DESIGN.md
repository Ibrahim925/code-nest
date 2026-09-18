---
name: Code Nest
description: A restrained research-protocol workstation for observable agent experiments.
colors:
  protocol-cobalt: "#1746a2"
  control-navy: "#111c33"
  ink: "#17233d"
  cool-canvas: "#e9edf2"
  protocol-paper: "#fbfcfe"
  divider: "#d8dde5"
  success: "#1d704a"
  warning: "#8c3440"
  focus: "#f0a629"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.45rem)"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 500
    lineHeight: 1.6
  label:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.035em"
rounded:
  control: "2px"
spacing:
  xs: "8px"
  sm: "18px"
  md: "28px"
  lg: "38px"
components:
  button-primary:
    backgroundColor: "{colors.protocol-cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "44px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "42px"
  protocol-sheet:
    backgroundColor: "{colors.protocol-paper}"
    textColor: "{colors.ink}"
    rounded: "0"
---

# Design System: Code Nest

## Overview

**Creative North Star: “The Research Protocol Workstation”**

Code Nest treats consequential agent runs as reproducible experiments. The interface should feel precise, calm, and inspectable: cool protocol paper, institutional cobalt, dark control surfaces, thin ruled ledgers, and explicit readiness language. It must never suggest that hidden reasoning or guilt is being observed.

Density is purposeful. Related inputs sit in clearly named protocol sections, while decisive actions live in a separate readiness record. Decoration stays subordinate to provenance, limits, state, and evidence.

**Key Characteristics:**

- Cool-white working surfaces on a pale technical canvas.
- Cobalt reserved for commitments, headings, and verified structure.
- Ruled rows for hashes, metadata, evidence, and status summaries.
- Square, restrained controls with explicit labels and state text.

## Colors

The palette uses one institutional accent, deep neutral controls, cool paper neutrals, and narrow semantic colors.

### Primary

- **Protocol Cobalt** (`#1746a2`): protocol headers, primary actions, and structural labels.

### Neutral

- **Control Navy** (`#111c33`): global navigation and persistent control chrome.
- **Ink** (`#17233d`): primary text and strong rules.
- **Cool Canvas** (`#e9edf2`): page background.
- **Protocol Paper** (`#fbfcfe`): working sheets and side records.
- **Divider** (`#d8dde5`): ledger rows and section boundaries.

### Semantic

- **Verified Green** (`#1d704a`): validated and pinned facts, always paired with text.
- **Hold Red** (`#8c3440`): incomplete or destructive states, always paired with text.
- **Focus Amber** (`#f0a629`): the universal keyboard focus outline.

**The Evidence Before Color Rule.** Status remains understandable when color is removed; words such as READY, HOLD, Running, and Cancelled carry the meaning.

## Typography

**Display and Body Font:** Avenir Next, with Avenir and Segoe UI fallbacks.

**Label/Mono Font:** SFMono-Regular, with Consolas and monospace fallbacks, only for identifiers and hashes.

**Character:** A single humanist sans-serif voice keeps the interface contemporary and serious. Scale, weight, casing, and rules create hierarchy without a decorative display face.

### Hierarchy

- **Display** (650, `clamp(2rem, 4vw, 3.45rem)`, 1.02): one protocol title per surface.
- **Title** (650, `1.45rem`): readiness and major secondary records.
- **Body** (500, `0.82–0.96rem`, 1.55–1.6): explanatory copy.
- **Label** (700–800, `0.58–0.75rem`, tracked uppercase where structural): fieldsets, table heads, and state metadata.
- **Identifier** (`0.68rem` monospace): digests, revisions, and protocol numbers.

## Layout

Primary operator surfaces use a bounded two-column grid: a flexible protocol sheet and a 330px decision record. The sheet uses 38px horizontal padding and a repeated section boundary. At 1040px the readiness record moves below the sheet; at 700px fields become single-column, adapter rows become two-column cards, and outer borders yield to the viewport edge.

The first viewport should establish the task, pinned-input assurance, and readiness decision. Long identifiers truncate visually but retain their full value as accessible title text.

## Elevation & Depth

Surfaces use one quiet ambient shadow (`0 14px 35px rgb(31 43 65 / 8%)`). Borders and tonal separation do most of the structural work; controls do not float independently.

**The Paper Stack Rule.** Elevation separates whole working records from the canvas, never individual data rows.

## Shapes

The system is rectilinear. Sheets have square corners; inputs and buttons use a 2px radius. Circular geometry is reserved for small status indicators and native radio controls. Thin borders and horizontal rules create the protocol-ledger rhythm.

## Components

### Buttons

- **Primary:** cobalt fill, white text, 44px minimum height, 2px corners.
- **Disabled:** cool gray fill and explicit disabled semantics.
- **Focus:** 3px amber outline with 3px offset.
- **Destructive:** red text and border; cancellation requires an inline confirmation group.

### Cards / Containers

- **Protocol sheet:** paper background, square corners, one ambient shadow, cobalt heading block.
- **Readiness record:** same paper material, sticky beside the protocol on wide screens.
- **Ledger:** dark top rule followed by thin neutral row dividers.

### Inputs / Fields

- **Style:** white fill, 1px neutral border, 2px radius, 42px minimum height.
- **Disabled:** gray fill and lower contrast while retaining legible values.
- **Error:** pale red field with a top rule; never use a decorative side stripe.

### Navigation

The 56px navy control bar contains the Code Nest mark and a text-labelled local-controller status. Navigation remains secondary to the current protocol.

## Do's and Don'ts

### Do:

- **Do** group decisions by experimental ownership: source, runtimes, condition, limits, then authority.
- **Do** expose full provenance and availability instead of synthesizing unsupported capabilities.
- **Do** pair every status color with precise text and an accessible live announcement.
- **Do** preserve the 38/28/18/8px spacing rhythm when extending operator surfaces.

### Don't:

- **Don't** represent private thought, guilt, or suspicion as ground truth.
- **Don't** use gradients, ornamental dashboards, faux physical stamps, or thick side-tab accents.
- **Don't** store bearer credentials in protocol state, browser persistence, URLs, or public environment variables.
- **Don't** exceed one strong primary action in a decision record.
