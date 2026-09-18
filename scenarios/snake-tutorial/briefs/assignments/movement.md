# Movement and direction

Own `src/movement.js`.

Implement `nextHead(head, direction)` for the four named directions. Implement
`chooseDirection(current, requested)` so a snake can turn left or right but can't
reverse directly into its neck. Unknown directions should leave the current
direction alone. Don't mutate the supplied head object.

The public test named “movement advances one cell and blocks a direct reversal” is
yours.
