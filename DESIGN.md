---
version: alpha
name: IPTV Accross Borders
description: An angular broadcast browser and local recording desk.
colors:
  background: "#101112"
  surface: "#191b1d"
  primary: "#ff4655"
  text: "#f1f0eb"
  muted: "#a4a6a8"
  border: "#36383b"
typography:
  sans:
    fontFamily: '"DM Sans", sans-serif'
  display:
    fontFamily: '"Barlow Condensed", Impact, sans-serif'
  mono:
    fontFamily: 'ui-monospace, monospace'
rounded:
  DEFAULT: "0"
spacing:
  section-gap: "2.5rem"
  page-max: "1580px"
components:
  button: {}
  card: {}
  dialog: {}
---

# IPTV Accross Borders Design System

## Overview

### Creative North Star
A broadcast control desk: decisive typography, rectangular channel tiles, fine rules, and a red signal mark. The user's references are ArtCraft and Valorant, specifically minimal presentation and sharp edges.

### Product context and register
Global public-TV viewers browse, watch, favorite, and record channels. English UI with broadcaster-provided names and device-local recording times. Product register with an expressive home headline. Use the folder-derived IPTV Accross Borders name and angular border/signal logo. No bubbly pills, floating card shadows, or decorative gradients.

Token ownership: `src/index.css` is the runtime token source. Frontmatter mirrors its `:root` values; Tailwind layout utilities in `src/App.tsx` consume equivalent values. Update this document and CSS together. Recording controls share `src/recording.tsx`.

## Colors
Charcoal background and slightly lighter surface; off-white primary text and gray secondary text. Red is the primary action and recording signal. State text always accompanies recording indicators. Borders establish grouping. Forced colors retains system scrollbars.

## Typography
DM Sans for reading and controls; Barlow Condensed for large headlines; monospace for signal labels and recording states. Display type is used sparingly. Broadcaster names remain mixed case. Time and byte values use locale-aware formatting or explicit MB units.

## Layout
Fixed 240px desktop sidebar; bottom navigation below 1024px. Main content max-width 1580px with 16–40px horizontal padding. Channel grid adapts from two to five columns. Document scroll owns catalog and library; dialogs scroll within the viewport. Hero signal graphic is hidden on phones. Recording rows stack on phones.

## Elevation & Depth
Thin borders and tonal layers carry hierarchy. Dialog backdrop dims content. Channel cards do not float or lift on hover.

## Shapes
Square controls, cards, preview panels and dialogs. Circular exceptions: recording dots and loading spinners.

## Components

### Foundational visual states
Visible focus outline, deliberate hover borders, disabled opacity and cursor, text status for asynchronous changes. Preserve catalog loading placeholders. Empty and failure states provide next steps.

### Buttons and actions
Solid red for primary action, outlined neutrals for secondary actions. Record channel is the same component in preview and full player. End recording finalizes captured data; Save video saves a finished file.

### Navigation and data display
Home, Discover, Favorites, Recordings. Explicit Load more keeps the catalog bounded. Filters show all categories and alphabetically sorted countries; active selections can be removed individually or reset together. Missing logos use a neutral TV symbol and label; never derive initials or numeric pseudo-logos. Active recording status remains visible across navigation.

### Forms and overlays
Category and Country use the shared ChannelFilters non-modal dialog picker with a search input and ordinary selection buttons. Desktop popups align to their trigger and flip when space is limited; phones use a wider panel. Native datetime-local controls use platform-owned pickers. Native dialog supplies modal focus, inert background, Escape handling and focus restoration. Field errors remain inline. Dates use the device timezone displayed in the form. Search is immediate and local, with an explicit clear action.

### Iconography
Existing 24px stroke SVG icons, typically displayed at 20px. Pair recording symbols with action text.

### Motion
Short state transitions only, with reduced-motion override. No decorative continuous animation beyond existing loading/live indicators.

### Content and data visualization
Plain action-led copy. Never imply that a listed channel is guaranteed reachable. Do not claim a scheduled job survives browser closure.

## Do's and Don'ts
- Do keep edges square and surfaces quiet.
- Do expose recording state, captured size, and stop/save actions.
- Don't return playlist files from recording actions.
- Don't hide browser recording limitations or imply background server scheduling.

## Catalog views and real data
Home and Discover are anchors in one catalog surface. Grid, List and Timeline share filters. Programme imagery and UTC-normalized times come only from published XMLTV feeds; unavailable source fields remain explicitly unavailable. Broadcaster logos appear alongside channel titles. Successfully loaded artwork can raise visible channels in the order. Normal-layer filter portals use z-index 15 below the sticky header at 20.

Channel logo tiles are transparent against the dark surface; prefer the API’s white logo variants when provided. Missing programme artwork falls back to an actual stream snapshot, labelled with its capture time. Loading snapshots use skeletons.
