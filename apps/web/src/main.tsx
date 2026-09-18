import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HttpOperatorRunClient } from "./run-setup/client.js";
import { RunSetupApp } from "./run-setup/RunSetupApp.js";
import "./run-setup/run-setup.css";
import "./styles.css";
import "./observatory/observatory.css";
import "./observatory/observatory-responsive.css";
import "./observatory/activity-feed.css";

const controllerUrl = import.meta.env.VITE_CONTROLLER_URL ?? "/api";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Code Nest could not find the #root application element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RunSetupApp
      controllerBaseUrl={controllerUrl}
      createClient={(token) => new HttpOperatorRunClient({
        baseUrl: controllerUrl,
        token,
      })}
    />
  </StrictMode>,
);
