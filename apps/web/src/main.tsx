import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HttpOperatorRunClient } from "./run-setup/client.js";
import { RunSetupApp } from "./run-setup/RunSetupApp.js";
import { ObservatoryPreview } from "./observatory/ObservatoryPreview.js";
import "./run-setup/run-setup.css";
import "./styles.css";
import "./observatory/observatory.css";
import "./observatory/observatory-responsive.css";
import "./observatory/agent-observatory.css";
import "./observatory/agent-observatory-responsive.css";
import "./observatory/activity-feed.css";
import "./observatory/evidence-inspector.css";
import "./town-hall/town-hall.css";
import "./observer/observer-mode.css";
import "./replay/replay.css";
import "./constitution-lab/constitution-lab.css";
import "./constitution-lab/constitution-lab-responsive.css";
import "./quality/quality.css";

const controllerUrl = import.meta.env.VITE_CONTROLLER_URL ?? "/api";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Code Nest could not find the #root application element.");
}

const showObservatoryPreview = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "observatory";

createRoot(rootElement).render(
  <StrictMode>
    {showObservatoryPreview ? <ObservatoryPreview /> : (
      <RunSetupApp
        controllerBaseUrl={controllerUrl}
        createClient={(token) => new HttpOperatorRunClient({
          baseUrl: controllerUrl,
          token,
        })}
      />
    )}
  </StrictMode>,
);
