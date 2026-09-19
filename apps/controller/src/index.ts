import { buildApp } from "./app.js";

const app = buildApp({ enableLocalOmpRunner: true });

try {
  await app.listen({ host: "127.0.0.1", port: 3100 });
} catch (error: unknown) {
  app.log.error(error);
  process.exitCode = 1;
}
