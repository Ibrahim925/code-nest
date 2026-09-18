import assert from "node:assert/strict";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const load = (file) => import(pathToFileURL(resolve("src", file)));
const [movement, food, collision, presenter, game] = await Promise.all([
  load("movement.js"), load("food.js"), load("collision.js"),
  load("presenter.js"), load("game.js"),
]);

assert.deepEqual(movement.nextHead({ x: 2, y: 2 }, "right"), { x: 3, y: 2 });
assert.equal(movement.chooseDirection("up", "down"), "up");
assert.equal(food.applyFood(
  [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
  0,
  { x: 2, y: 1 },
).score, 10);
assert.equal(collision.collisionKind([{ x: -1, y: 0 }], 12, 12), "wall");
assert.equal(presenter.presentGame(game.createGame()).scoreLabel, "Score 0");
process.stdout.write("Snake tutorial public checks passed.\n");
