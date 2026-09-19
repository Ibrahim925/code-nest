import { deflateSync } from "node:zlib";

import type {
  OmpCaptureReason,
  OmpComputerCapture,
  OmpComputerCapturePort,
} from "@code-nest/adapters";

import type { ContainedOmpBoundary } from "../application/ports/contained-omp-ports.js";

const WIDTH = 960;
const HEIGHT = 540;
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  " ": [0, 0, 0, 0, 0, 0, 0], "-": [0, 0, 0, 31, 0, 0, 0], ".": [0, 0, 0, 0, 0, 12, 12],
  "/": [1, 2, 4, 8, 16, 0, 0], ":": [0, 12, 12, 0, 12, 12, 0],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31], "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 16, 30, 1, 1, 30],
  "6": [14, 16, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function integer(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0);
  return bytes;
}

function chunk(kind: string, data = Buffer.alloc(0)): Buffer {
  const name = Buffer.from(kind, "ascii");
  const content = Buffer.concat([name, data]);
  return Buffer.concat([integer(data.byteLength), content, integer(crc32(content))]);
}

class Canvas {
  readonly pixels = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);

  constructor() {
    for (let y = 0; y < HEIGHT; y += 1) {
      this.pixels[y * (WIDTH * 3 + 1)] = 0;
    }
    this.rectangle(0, 0, WIDTH, HEIGHT, [17, 28, 51]);
  }

  rectangle(x: number, y: number, width: number, height: number, color: readonly number[]): void {
    for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + height); row += 1) {
      for (let column = Math.max(0, x); column < Math.min(WIDTH, x + width); column += 1) {
        const offset = row * (WIDTH * 3 + 1) + 1 + column * 3;
        this.pixels[offset] = color[0] ?? 0;
        this.pixels[offset + 1] = color[1] ?? 0;
        this.pixels[offset + 2] = color[2] ?? 0;
      }
    }
  }

  text(value: string, x: number, y: number, scale: number, color: readonly number[]): void {
    let cursor = x;
    for (const character of value.toUpperCase().slice(0, 80)) {
      const glyph = GLYPHS[character] ?? GLYPHS[" "] ?? [];
      glyph.forEach((bits, row) => {
        for (let column = 0; column < 5; column += 1) {
          if ((bits & (1 << (4 - column))) !== 0) {
            this.rectangle(cursor + column * scale, y + row * scale, scale, scale, color);
          }
        }
      });
      cursor += 6 * scale;
    }
  }

  png(): Uint8Array {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0);
    header.writeUInt32BE(HEIGHT, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(this.pixels, { level: 6 })),
      chunk("IEND"),
    ]);
  }
}

function safeText(bytes: Uint8Array, fallback: string): string {
  const value = Buffer.from(bytes).toString("utf8").trim().toUpperCase();
  return /^[A-F0-9]{7,40}$/u.test(value) || /^\d{1,6}$/u.test(value) ? value : fallback;
}

export class WorkspaceComputerCapture implements OmpComputerCapturePort {
  #captureSequence = 0;

  constructor(
    private readonly boundary: ContainedOmpBoundary,
    private readonly participantId: string,
  ) {}

  async capture(reason: OmpCaptureReason): Promise<OmpComputerCapture> {
    this.#captureSequence += 1;
    const [revisionResult, changesResult] = await Promise.all([
      this.boundary.execute({ executable: "git", arguments: ["rev-parse", "--short=12", "HEAD"] }),
      this.boundary.execute({ executable: "/bin/sh", arguments: ["-c", "git status --porcelain | wc -l"] }),
    ]);
    if (revisionResult.exitCode !== 0 || changesResult.exitCode !== 0) {
      return { status: "withheld", reason: "capture_failed" };
    }
    const canvas = new Canvas();
    canvas.rectangle(34, 32, 892, 54, [23, 70, 162]);
    canvas.text(`CODE NEST / ${this.participantId}`, 56, 48, 3, [248, 250, 252]);
    canvas.text("OMP 18.1.14 / OPENAI LUNA", 56, 126, 4, [120, 167, 255]);
    canvas.text(
      `CAPTURE / ${this.#captureSequence} / ${reason.replaceAll("_", " ")}`,
      56,
      184,
      3,
      [181, 195, 215],
    );
    canvas.rectangle(56, 244, 848, 1, [85, 100, 125]);
    canvas.text(`REVISION / ${safeText(revisionResult.stdout, "UNAVAILABLE")}`, 56, 286, 3, [248, 250, 252]);
    canvas.text(`WORKSPACE CHANGES / ${safeText(changesResult.stdout, "UNAVAILABLE")}`, 56, 340, 3, [248, 250, 252]);
    canvas.rectangle(56, 420, 12, 12, [49, 168, 109]);
    canvas.text("CONTAINED RUNTIME CONNECTED", 84, 416, 3, [185, 226, 202]);
    return {
      status: "visible",
      bytes: canvas.png(),
      width: WIDTH,
      height: HEIGHT,
      redactionStatus: "clear",
    };
  }
}
