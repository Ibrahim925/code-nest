import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HttpOperatorRunClient } from "./run-setup/client.js";
import { RunSetupApp } from "./run-setup/RunSetupApp.js";
import "./run-setup/run-setup.css";
import "./styles.css";

const controllerUrl = import.meta.env.VITE_CONTROLLER_URL ?? "/api";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Code Nest could not find the #root application element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RunSetupApp
      createClient={(token) => new HttpOperatorRunClient({
        baseUrl: controllerUrl,
        token,
      })}
    />
  </StrictMode>,
);
