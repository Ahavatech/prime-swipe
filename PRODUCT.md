# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: reuse the nearby 2048 project's static vanilla frontend and separate Node/Express API architecture; keep Prime Swipe's API and database identity separate.

## Users

Casual players on desktop or mobile who want a quick, accessible logic/puzzle game.

## Product Purpose

Prime Swipe is a 4×4 sliding-tile game in which players combine adjacent tiles only when their sum is prime. Success is an ongoing run, with 101 as a milestone rather than an ending.

## Positioning

Unlike power-of-two merge games, Prime Swipe makes every move a parity- and prime-sum decision, with a special 1+1=2 exception.

## Operating Context

Players use arrow keys, WASD, or touch swipes. They can replay after a run ends and may opt in to submit a run to a separate public leaderboard.

## Capabilities and Constraints

- Start with one randomly placed odd tile (1 or 3) and one randomly placed even tile (2 or 4).
- Pack tiles toward the swipe edge, merge adjacent pairs only when their sum is prime, and permit each tile to merge at most once per swipe.
- Spawn one weighted tile after each changed swipe; apply unlock thresholds and parity assist as specified in the product brief.
- Track cumulative merge score separately from the largest prime tile built. The local best measures the latter.
- Continue after reaching 101; end only on a full board with no legal adjacent prime-sum merge.
- Keep the API, database, deployment identity, and leaderboard data isolated from 2048.
- Preserve accessible keyboard and touch interaction, clear error states, and a manually triggered static-site release.

## Product Principles

- Make each merge rule and game state understandable at a glance.
- Keep score, largest-prime best, and milestone status distinct.
- Let players continue past the milestone without interrupting play.
- Treat touch, keyboard, reduced motion, and assistive technology as first-class.
- Never imply a leaderboard action succeeded without backend confirmation.

## Accessibility & Inclusion

Support keyboard operation, touch, visible focus, accessible board labels, live announcements, reduced motion, and small-screen layouts.
