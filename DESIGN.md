---
name: Prime Swipe
description: A precise, grid-built visual system for a prime-sum puzzle.
colors:
  construction-blue: "#2f66b3"
  construction-blue-deep: "#234f8c"
  coral-signal: "#e36a4c"
  coral-deep: "#9c3d29"
  deep-navy: "#172b4d"
  soft-ink: "#435b7b"
  reading-ink: "#344c6c"
  page-ground: "#f5f7fb"
  paper: "#ffffff"
  pale-blue: "#dce7f3"
  empty-cell: "#e7edf5"
  tile-blue-light: "#d6e2f0"
  tile-blue-mid: "#bfd1e7"
  tile-blue-strong: "#a9c2e0"
  blue-divider: "#b8c8dd"
  soft-divider: "#d5deea"
typography:
  display:
    fontFamily: '"Aldrich", sans-serif'
    fontSize: "clamp(24px, 3.4vw, 36px)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontWeight: 400
    lineHeight: 1.55
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "19px"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 700
  numeric:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(22px, 5.2vw, 48px)"
    fontWeight: 760
    lineHeight: 1
    letterSpacing: "-0.04em"
  control:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  cell: "5px"
  field: "8px"
  control: "9px"
  board: "12px"
  dialog: "14px"
spacing:
  compact: "12px"
  standard: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.construction-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
    typography: "{typography.control}"
  button-light:
    backgroundColor: "{colors.page-ground}"
    textColor: "{colors.deep-navy}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
    typography: "{typography.control}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.deep-navy}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
    typography: "{typography.control}"
  game-board:
    backgroundColor: "{colors.deep-navy}"
    rounded: "{rounded.board}"
    width: "min(100%, 500px)"
  game-tile:
    backgroundColor: "{colors.tile-blue-light}"
    textColor: "{colors.deep-navy}"
    rounded: "{rounded.cell}"
  text-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.deep-navy}"
    rounded: "{rounded.field}"
    padding: "9px 12px"
  stat-row:
    textColor: "{colors.deep-navy}"
    padding: "8px 0"
---

# Design System: Prime Swipe

## Overview

**Creative North Star: "The Prime Construction Grid"**

Prime Swipe's visual signature is a small, geometric identity mark and a square game matrix. The self-hosted Aldrich face gives the wordmark and lead heading a distinct, grid-conscious voice; the system sans carries actions, rules, feedback, and values so play stays legible.

Cool pale surfaces and deep navy ink frame construction-blue structure. Coral appears as a compact signal for focus and meaningful game states. Geometry belongs to the board and its measured cells rather than to background decoration: the board is the largest control on desktop and leads the stacked layout on narrow screens.

**Key Characteristics:**
- A visible four-by-four construction grid with stable square cells.
- Aldrich display lettering paired with a system-sans interface.
- Pale blue-white surfaces, navy ink, construction blue, and restrained coral signals.
- Responsive, keyboard- and touch-operable game controls with visible focus and reduced motion.

## Colors

The palette pairs cool paper-like surfaces and navy legibility with construction blue for structure and a small coral signal for state.

### Primary
- **Construction Blue:** The main action, interactive disclosure, header rule, and selection color; the darker companion is used on the primary-button hover state.

### Secondary
- **Coral Signal:** Reserved in the interface for visible focus, the merge mark, the 101 achieved state, and the small identity mark; a deeper coral marks the achieved-goal text.

### Neutral
- **Deep Navy:** Primary text, the header, board ground, and strong section structure.
- **Soft Ink and Reading Ink:** Supporting status text and explanatory copy.
- **Page Ground and Paper:** The cool page canvas and white controls or table surface.
- **Pale Blue and Tile Blues:** The board's empty-cell and value-state fills.
- **Blue Dividers and Soft Dividers:** Fine structure between board-related and tabular content.

**The Signal Economy Rule.** Keep coral attached to a meaningful state, focus, or identity detail; do not turn it into a broad decorative fill.

## Typography

**Display Font:** Aldrich (self-hosted WOFF2, with sans-serif fallback)<br>
**Body Font:** System sans (system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)<br>
**Label/Mono Font:** No separate mono face; labels and data use the system sans.

**Character:** Aldrich's squared, technical letterforms mark the identity and opening statement. A familiar system sans keeps the game instructions, controls, status, and numeric readouts direct.

### Hierarchy
- **Display** (regular, responsive sizing): The page's lead heading; the brand uses the same face at a compact size.
- **Title** (bold, compact): Board, stats, rules, and leaderboard section headings.
- **Body** (observed 13–17px supporting-copy sizes): Rules, status, helper copy, and descriptions use the inherited body rhythm.
- **Label** (bold, compact): Small data and table labels.
- **Numeric** (bold, responsive sizing): Board values use tabular numerals and tight tracking; score readouts use the same bold, tabular treatment at a smaller size.

**The Two-Voice Rule.** Keep Aldrich to the wordmark and lead heading; use the system sans for operating text and game data.

## Layout

The page uses a centered shell capped at 1120px. At wide widths the game workspace is a two-column grid: the 4×4 board receives the larger share, and the status/rules sidebar sits alongside it. The board remains square and width-limited, with four equal rows and columns; its cell gutter and matching inner inset scale together.

At 820px and below, the workspace stacks with the board first. The sidebar stays two columns until 560px, then stacks; the header, leaderboard action, name entry, run summary, and dialog actions also reflow for narrow screens. At 560px the shell side inset narrows, with a further inset reduction below 360px. The layout has no horizontal board overflow.

The recurring spacing stays compact within groups and opens between sections; the board gap is responsive rather than fixed.

**The Square-Board Rule.** Preserve a square, evenly divided 4×4 board as the visual and interaction center at every breakpoint.

## Elevation & Depth

Most hierarchy comes from crisp borders, divider rules, and tonal changes between board cells. The current board and game-over dialog also use soft navy shadows beneath outlined surfaces; those are local implementation exceptions, not a reusable elevation rule. Do not propagate that border-plus-shadow pairing to new surfaces.

Reduced-motion preferences are honored globally: transitions and animations collapse to 0.01ms and scroll behavior is set to auto. The single authored merge moment otherwise uses a short ease-out build highlight.

## Shapes

The system is built from rectangular geometry with modest corner easing: board cells, controls, fields, the board, and game-over dialog each use distinct, low-to-moderate radius tokens. The grid border, fixed cell count, and even gutters do more to define the board than its radius.

**The Cell Geometry Rule.** Keep cells equal, square, and clearly separated; corner rounding stays secondary to the measured grid.

## Components

### Buttons
- **Character:** Compact, confident controls with clear hierarchy and state feedback.
- **Shape:** Gently rounded corners, comfortable padding, and a 46px minimum target height.
- **Primary:** Construction-blue fill with white text; the hover fill deepens.
- **Light:** Page-ground fill with navy text; hover shifts to pale blue.
- **Outline:** Transparent fill with a blue-gray stroke; hover adds a pale surface.
- **Hover / Focus:** Buttons rise 1px on hover and return on press. Keyboard focus uses a 3px coral outline with a 3px offset.
- **Motion:** Background, text, border, and transform transitions use 140ms ease; reduced motion reduces durations.

### Cards / Containers
- **Board:** A square 4×4 navy grid with a responsive gutter, thin outline, and softly rounded corners. Its cells remain the dominant, stable surface.
- **Statistics and Rules:** These are open, border-separated regions rather than filled cards; the stats list uses fine horizontal dividers.
- **Leaderboard:** The table sits in a white, thin-bordered, horizontally scrollable wrapper; rows use fine dividers and tabular numerals.

### Inputs / Fields
- **Style:** White field, navy text, a fine blue-gray stroke, and a softly rounded shape with comfortable padding; the field is at least 46px high.
- **Focus:** The shared coral focus outline remains visible.
- **Disabled:** The input changes to the empty-cell surface.

### Game Board and Tiles
- **Grid:** The board exposes a labeled 4×4 grid; cells are rendered as individually labeled gridcells.
- **Tiles:** Values use bold tabular system numerals over a restrained blue fill progression. Empty cells remain visibly distinct.
- **Merge State:** A thin coral corner mark and a brief inset highlight identify the newly built tile without changing the cell geometry.

### Statistics
- **Rows:** Score, largest-prime Best, and 101 status remain separate values. Rows align labels and numbers across a shared divider; numeric values are right-aligned and tabular.
- **Goal Note:** The 101 message uses a pale warm surface and dark warm text to distinguish the milestone without implying that play ends.

## Do's and Don'ts

### Do:
- **Do** retain the responsive square 4×4 board and its equal cell geometry.
- **Do** use the coral outline for keyboard focus and the coral mark for meaningful merge or goal states.
- **Do** keep Score, largest-prime Best, and goal status visually distinct; use tabular numerals for game data.
- **Do** preserve the system-sans workhorse and the self-hosted Aldrich display roles.
- **Do** respect reduced-motion preferences and keep the board usable by touch and keyboard.

### Don't:
- **Don't** use coral as a broad decorative color; its role is a compact signal.
- **Don't** spread Aldrich across dense rules, controls, and game data.
- **Don't** reshape the board or vary cell geometry to create decoration.
- **Don't** repeat the existing outlined-board/dialog plus soft-shadow pairing as a new surface recipe; it is source drift, not a depth token.
