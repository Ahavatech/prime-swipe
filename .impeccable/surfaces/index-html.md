---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

SCOPE: The single-page Prime Swipe web game. Visitor mode: Operate.
AUDIENCE: Casual players on desktop or mobile. They want a quick, accessible logic puzzle they can play with keyboard or touch.
TASK: Read the 4×4 board, choose a swipe, and understand why a prime-sum merge did or did not happen. Follow score, local largest-prime best, and the 101 milestone; continue until no legal board merge remains.
CONTENT: Live board and status, cumulative score, device best largest prime, 101 goal state, concise controls and rules, run summary, opt-in leaderboard name entry, and server-confirmed rankings. Rank by cumulative score; show largest prime as a separate stat.
CONSTRAINTS: Preserve the familiar 4×4 puzzle-board organization; prime sums only, each tile merges once per swipe, 1+1=2, weighted spawns and parity assist; 101 never ends play. Support arrows, WASD, touch, accessible labels, live announcements, visible focus, reduced motion, and small screens. Keep API and database separate from 2048. The Pages build injects an HTTPS API origin, publishes an allowlisted frontend artifact only, and remains manually triggered.

## Direction contract

THESIS: Prime Swipe turns each move into a legible prime-sum decision, with its construction grid serving play rather than competing with it. It refuses same-value power-of-two merging.

OWN-WORLD: Use precise, visible cell geometry, a pale blue-white ground, deep navy ink, construction-blue structure, and a small coral signal reserved for a meaningful merge or goal state. A workhorse sans keeps numerals direct. The grid belongs to the board and aligns the rest of the interface; no ornamental grain, gradient, or irregular board shape.

STORY: Players see Score, local largest-prime Best, and the still-open 101 milestone before their first move. The board remains the familiar center of the page. A short rules section explains prime sums and 1+1=2; status text describes merges, spawns, errors, and game over. Players can opt in to submit a run; only a validated API response confirms its rank.

FIRST VIEWPORT: A compact Prime Swipe heading and rules affordance lead a responsive two-column desktop shell: the square 4×4 board is the largest area; Score, Best, 101 status, keyboard/touch controls, and a concise prime-rule note sit beside it. On narrow screens these become one column, with the board first and controls reachable without horizontal scrolling. The primary action is a keyboard- and touch-operable New game button. A prime merge receives one precise construction-blue/coral mark, while all tiles retain stable cell geometry.

FORM: Build the assigned Wim Crouwel grid-constructed type-specimen direction, candidate six of the grounded list, seed c7edf2ec. The category's familiar board layout remains intact; the visible construction grid supplies type, palette, density, and a single merge mark, never a new navigation or control model.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
