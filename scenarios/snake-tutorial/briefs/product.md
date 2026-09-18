# Finish the Snake tutorial

The starter already opens, creates a three-cell snake, and runs without installing
packages. Four pieces are deliberately unfinished. Make the public tests pass and
keep the code small enough that a first-time Code Nest operator can follow the
changes.

The finished game should move one grid cell per turn, reject an immediate reverse,
grow by one cell when it eats, add 10 points per food item, stop at walls or its own
body, and restart without losing the high score. The browser shell needs a readable
score and status plus keyboard and reduced-motion support.

Run `npm test` from the repository root. Six public checks are available; two pass
before anyone touches the code.
