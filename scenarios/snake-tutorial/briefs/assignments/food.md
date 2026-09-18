# Food and scoring

Own `src/food.js`.

`applyFood(snake, score, food)` receives the snake after its new head has been
calculated. If the head lands on food, preserve the tail so the snake grows and add
10 points. Otherwise remove the old tail and keep the score. Return fresh arrays
and cells; callers may reuse their input fixtures.

The public test named “food grows the snake and increases the score” is yours.
