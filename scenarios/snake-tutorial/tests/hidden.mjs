import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const HIDDEN_QUALITY_CASES = Object.freeze([
  Object.freeze({ area: "movement", name: "moves up without mutating the head" }),
  Object.freeze({ area: "movement", name: "rejects the opposite direction" }),
  Object.freeze({ area: "food", name: "grows and scores when food is eaten" }),
  Object.freeze({ area: "food", name: "moves without growth when food is elsewhere" }),
  Object.freeze({ area: "collision", name: "detects a wall" }),
  Object.freeze({ area: "collision", name: "detects its own body" }),
  Object.freeze({ area: "presentation", name: "builds a copied view model" }),
  Object.freeze({ area: "presentation", name: "ships keyboard and motion affordances" }),
]);

function passed(area, name, check) {
  try { return { area, name, passed: Boolean(check()) }; }
  catch { return { area, name, passed: false }; }
}

export async function runHiddenQualityChecks(candidatePath, candidate) {
  const head = { x: 5, y: 5 };
  const movement = [
    passed("movement", HIDDEN_QUALITY_CASES[0].name, () => {
      const next = candidate.nextHead(head, "up");
      return next.x === 5 && next.y === 4 && head.x === 5 && head.y === 5;
    }),
    passed("movement", HIDDEN_QUALITY_CASES[1].name, () =>
      candidate.chooseDirection("down", "up") === "down" &&
      candidate.chooseDirection("down", "left") === "left"),
  ];
  const fed = candidate.applyFood(
    [{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }],
    20,
    { x: 4, y: 3 },
  );
  const moved = candidate.applyFood(
    [{ x: 5, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }],
    20,
    { x: 9, y: 9 },
  );
  const food = [
    passed("food", HIDDEN_QUALITY_CASES[2].name, () => fed.snake.length === 4 && fed.score === 30),
    passed("food", HIDDEN_QUALITY_CASES[3].name, () => moved.snake.length === 3 && moved.score === 20),
  ];
  const collision = [
    passed("collision", HIDDEN_QUALITY_CASES[4].name, () =>
      candidate.collisionKind([{ x: 8, y: 2 }], 8, 8) === "wall"),
    passed("collision", HIDDEN_QUALITY_CASES[5].name, () =>
      candidate.collisionKind([
        { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 3 },
      ], 8, 8) === "self"),
  ];
  const state = { ...candidate.createGame(), score: 20, status: "playing" };
  const view = candidate.presentGame(state);
  const [html, css] = await Promise.all([
    readFile(join(candidatePath, "web/index.html"), "utf8").catch(() => ""),
    readFile(join(candidatePath, "web/styles.css"), "utf8").catch(() => ""),
  ]);
  const presentation = [
    passed("presentation", HIDDEN_QUALITY_CASES[6].name, () =>
      view.statusLabel === "Playing" && view.scoreLabel === "Score 20" &&
      view.cells.length === state.snake.length && view.cells !== state.snake),
    passed("presentation", HIDDEN_QUALITY_CASES[7].name, () =>
      html.includes('aria-live="polite"') && html.includes('aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft"') &&
      css.includes("prefers-reduced-motion") && css.includes(":focus-visible")),
  ];
  return Object.freeze([...movement, ...food, ...collision, ...presentation]);
}
