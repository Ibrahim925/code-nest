# Collision and restart

Own `src/collision.js`.

`collisionKind(snake, width, height)` should return `wall`, `self`, or `null` by
examining the head against the board and the rest of the body. `restartGame(state)`
should return a fresh ready state with the normal three-cell snake, zero current
score, and the previous high score. Keep the board dimensions.

The public test named “collisions end play and restart preserves the high score” is
yours.
