import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function HarnessReady(): React.JSX.Element {
  return (
    <main>
      <p className="eyebrow">CODE NEST</p>
      <h1>The harness is ready.</h1>
      <p>Feature implementation begins after initialization is checkpointed.</p>
    </main>
  );
}

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Code Nest could not find the #root application element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <HarnessReady />
  </StrictMode>,
);
