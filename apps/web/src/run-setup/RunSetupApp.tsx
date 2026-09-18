import { useMemo, useState } from "react";

import { ComparisonImportControl } from "../constitution-lab/ComparisonImportControl.js";
import { ConstitutionLab } from "../constitution-lab/ConstitutionLab.js";
import type { LabComparison } from "../constitution-lab/domain/comparison.js";
import { LiveObservatory } from "../observatory/LiveObservatory.js";
import type { ReplayBundle } from "@code-nest/protocol";
import { ReplayImportControl } from "../replay/ReplayImportControl.js";
import { ReplayViewer } from "../replay/ReplayViewer.js";
import { DEFAULT_RUN_SETUP, SETUP_CATALOG } from "./catalog.js";
import {
  OperatorClientError,
  type OperatorRunClient,
  type RunMutation,
} from "./client.js";
import {
  validateRunSetup,
  type RunControlView,
  type RunSetupConfiguration,
} from "./domain.js";
import { SetupFields } from "./SetupFields.js";

export interface RunSetupAppProps {
  readonly createClient: (token: string) => OperatorRunClient;
  readonly controllerBaseUrl?: string;
  readonly initialConfiguration?: RunSetupConfiguration;
}

function safeMessage(error: unknown): string {
  return error instanceof OperatorClientError
    ? error.message
    : "The control request failed unexpectedly. Inspect the controller log.";
}

export function RunSetupApp({
  createClient,
  controllerBaseUrl = "/api",
  initialConfiguration = DEFAULT_RUN_SETUP,
}: RunSetupAppProps): React.JSX.Element {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [operatorToken, setOperatorToken] = useState("");
  const [run, setRun] = useState<RunControlView | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | RunMutation | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayBundle | null>(null);
  const [comparison, setComparison] = useState<LabComparison | null>(null);
  const validation = useMemo(
    () => validateRunSetup(configuration, SETUP_CATALOG),
    [configuration],
  );
  const locked = run !== null || pendingAction !== null;
  const ready = validation.ok && operatorToken.trim().length > 0;

  if (replay !== null) {
    return <ReplayViewer bundle={replay} onClose={() => setReplay(null)} />;
  }

  if (comparison !== null) {
    return <ConstitutionLab comparison={comparison} onClose={() => setComparison(null)} />;
  }

  const start = async () => {
    if (!validation.ok || !ready) return;
    setPendingAction("start");
    setRequestError(null);
    try {
      setRun(await createClient(operatorToken).start(validation.configuration));
    } catch (error: unknown) {
      setRequestError(safeMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const mutate = async (action: RunMutation) => {
    if (run === null) return;
    setPendingAction(action);
    setRequestError(null);
    try {
      setRun(await createClient(operatorToken).mutate(run.runId, action));
    } catch (error: unknown) {
      setRequestError(safeMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  if (run !== null) {
    return (
      <LiveObservatory
        baseUrl={controllerBaseUrl}
        bearerToken={operatorToken}
        configuration={configuration}
        run={run}
        pendingAction={pendingAction === "start" ? null : pendingAction}
        controlError={requestError}
        onMutation={(action) => void mutate(action)}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#run-protocol" aria-label="Code Nest run setup">
          <span className="wordmark-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>Code Nest</span>
        </a>
        <div className="environment-mark">
          <span aria-hidden="true" /> Local controller
        </div>
      </header>

      <main id="run-protocol" className="setup-layout">
        <section className="protocol-sheet" aria-labelledby="setup-title">
          <header className="sheet-heading">
            <div>
              <h1 id="setup-title">Prepare a match protocol</h1>
              <p>
                Fix every reproducibility input before four agents enter the repository.
              </p>
            </div>
            <div className="protocol-number" aria-label="Protocol identifier">
              CN / RUN<br /><strong>001</strong>
            </div>
          </header>

          <form
            id="run-setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <SetupFields
              configuration={configuration}
              disabled={locked}
              onChange={setConfiguration}
            />
          </form>
        </section>

        <aside className="readiness-panel" aria-labelledby="readiness-title">
          <div className={`readiness-stamp ${ready ? "is-ready" : ""}`}>
            <span>{ready ? "Validated" : "Incomplete"}</span>
            <strong>{ready ? "READY" : "HOLD"}</strong>
          </div>
          <h2 id="readiness-title">Readiness record</h2>
          <p className="readiness-intro">
            Start stays locked until the protocol and local operator authority are valid.
          </p>

          <dl className="readiness-list">
            <div><dt>Scenario</dt><dd>Station Access · SHA-256 pinned</dd></div>
            <div><dt>Roster</dt><dd>{configuration.adapters.length} participant slots</dd></div>
            <div><dt>Condition</dt><dd>{configuration.constitution.replaceAll("-", " ")}</dd></div>
            <div><dt>Disclosure</dt><dd>{configuration.disclosurePolicy.replaceAll("-", " ")}</dd></div>
          </dl>

          {!validation.ok && (
            <div className="issue-summary" role="alert">
              <h3>Protocol needs attention</h3>
              <ul>
                {validation.issues.map((item) => (
                  <li key={`${item.path}-${item.message}`}>
                    <strong>{item.path}</strong> {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="token-field" htmlFor="operator-token">
            Local operator token
            <input
              id="operator-token"
              name="operatorToken"
              type="password"
              value={operatorToken}
              onChange={(event) => setOperatorToken(event.target.value)}
              disabled={pendingAction !== null || run !== null}
              autoComplete="off"
              aria-describedby="token-help"
            />
            <span id="token-help">Held in this page only; never saved in the run protocol.</span>
          </label>

          {requestError !== null && (
            <p className="request-error" role="alert">{requestError}</p>
          )}

          <button
            className="primary-action"
            type="submit"
            form="run-setup-form"
            disabled={!ready || pendingAction !== null}
          >
            {pendingAction === "start" ? "Starting match…" : "Start match"}
          </button>

          <p className="status-announcement" aria-live="polite">
            {pendingAction === null
              ? "No run has started."
              : `${pendingAction} request in progress.`}
          </p>

          <ReplayImportControl onLoad={setReplay} />
          <ComparisonImportControl onLoad={setComparison} />
        </aside>
      </main>
    </div>
  );
}
