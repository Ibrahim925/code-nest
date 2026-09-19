import type {
  AdapterSelection,
  RunLimits,
  RunSetupConfiguration,
} from "./domain.js";

interface SetupFieldsProps {
  readonly configuration: RunSetupConfiguration;
  readonly disabled: boolean;
  readonly onChange: (configuration: RunSetupConfiguration) => void;
}

export function withOmpLunaPreset(
  configuration: RunSetupConfiguration,
): RunSetupConfiguration {
  return {
    ...configuration,
    adapters: configuration.adapters.map((adapter) => ({
      ...adapter,
      adapterId: "omp-rpc",
      executionMode: "contained" as const,
      modelDisclosure: "OpenAI Luna · OMP 18.1.14",
    })),
    limits: { ...configuration.limits, rounds: 3 },
  };
}

const LIMIT_FIELDS: readonly {
  readonly key: keyof RunLimits;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}[] = [
  { key: "rounds", label: "Rounds", unit: "count", min: 1, max: 3 },
  { key: "roundDurationSeconds", label: "Round duration", unit: "seconds", min: 1, max: 3_600 },
  { key: "trustedTestWallTimeSeconds", label: "Trusted test limit", unit: "seconds", min: 1, max: 3_600 },
  { key: "cpuCores", label: "CPU allowance", unit: "cores", min: 1, max: 2 },
  { key: "memoryMiB", label: "Memory", unit: "MiB", min: 128, max: 4_096 },
  { key: "processLimit", label: "Process limit", unit: "processes", min: 1, max: 256 },
  { key: "workspaceMiB", label: "Workspace", unit: "MiB", min: 1, max: 10_240 },
  { key: "temporaryStorageMiB", label: "Temporary storage", unit: "MiB", min: 1, max: 512 },
];

function Pin({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="pin-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
      <strong aria-label={`${label} verified`}>Pinned</strong>
    </div>
  );
}

export function SetupFields({
  configuration,
  disabled,
  onChange,
}: SetupFieldsProps): React.JSX.Element {
  const patch = (change: Partial<RunSetupConfiguration>) => {
    onChange({ ...configuration, ...change });
  };
  const patchAdapter = (index: number, change: Partial<AdapterSelection>) => {
    patch({
      adapters: configuration.adapters.map((adapter, adapterIndex) =>
        adapterIndex === index ? { ...adapter, ...change } : adapter
      ),
    });
  };
  const patchLimits = (change: Partial<RunLimits>) => {
    patch({ limits: { ...configuration.limits, ...change } });
  };
  const useOmpLuna = () => onChange(withOmpLunaPreset(configuration));
  const selectAdapter = (index: number, adapterId: string) => {
    patchAdapter(index, adapterId === "omp-rpc" ? {
      adapterId,
      executionMode: "contained",
      modelDisclosure: "OpenAI Luna · OMP 18.1.14",
    } : {
      adapterId,
      executionMode: "split",
      modelDisclosure: "Deterministic fixture · no model provider",
    });
  };

  return (
    <div className="protocol-fields">
      <fieldset disabled={disabled}>
        <legend>Run identity and pinned source</legend>
        <div className="field-pair">
          <label htmlFor="run-id">
            Run ID
            <input
              id="run-id"
              name="runId"
              value={configuration.runId}
              onChange={(event) => patch({ runId: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label htmlFor="scenario">
            Scenario
            <select
              id="scenario"
              name="scenario.id"
              value={configuration.scenario.id}
              onChange={(event) => patch({
                scenario: { ...configuration.scenario, id: event.target.value },
              })}
            >
              <option value="station-access">Station Access</option>
            </select>
          </label>
        </div>
        <div className="pin-ledger" aria-label="Pinned scenario inputs">
          <Pin label="Manifest" value={configuration.scenario.manifestDigest} />
          <Pin label="Repository" value={configuration.scenario.repositoryRevision} />
          <Pin label="Participant image" value={configuration.scenario.participantImage} />
          <Pin label="Evaluator image" value={configuration.scenario.evaluatorImage} />
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Four participant runtimes</legend>
        <p className="field-note">
          Every slot declares its adapter, execution boundary, and model provenance.
        </p>
        <button className="runtime-preset" type="button" onClick={useOmpLuna}>
          Use four isolated OMP · Luna agents
        </button>
        <div className="adapter-table">
          <div className="adapter-head" aria-hidden="true">
            <span>Participant</span><span>Adapter</span><span>Mode</span><span>Disclosure</span>
          </div>
          {configuration.adapters.map((adapter, index) => (
            <div className="adapter-row" key={adapter.participantId}>
              <label>
                <span>Participant</span>
                <input
                  name={`adapters.${index}.participantId`}
                  value={adapter.participantId}
                  onChange={(event) => patchAdapter(index, { participantId: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label>
                <span>Adapter</span>
                <select
                  name={`adapters.${index}.adapterId`}
                  value={adapter.adapterId}
                  onChange={(event) => selectAdapter(index, event.target.value)}
                >
                  <option value="fake-scripted" disabled>Deterministic fake · not installed</option>
                  <option value="omp-rpc">OMP RPC · OpenAI Luna</option>
                  <option value="subprocess" disabled>Subprocess · not installed</option>
                  <option value="direct-model" disabled>Direct model · not installed</option>
                </select>
              </label>
              <label>
                <span>Mode</span>
                <select
                  name={`adapters.${index}.executionMode`}
                  value={adapter.executionMode}
                  onChange={(event) => patchAdapter(index, {
                    executionMode: event.target.value as AdapterSelection["executionMode"],
                  })}
                >
                  <option value="split">Split</option>
                  <option value="contained">Contained</option>
                </select>
              </label>
              <label>
                <span>Disclosure</span>
                <input
                  name={`adapters.${index}.modelDisclosure`}
                  value={adapter.modelDisclosure}
                  onChange={(event) => patchAdapter(index, { modelDisclosure: event.target.value })}
                />
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Experimental condition</legend>
        <div className="condition-grid">
          <label htmlFor="constitution">
            Constitution
            <select
              id="constitution"
              name="constitution"
              value={configuration.constitution}
              onChange={(event) => patch({
                constitution: event.target.value as RunSetupConfiguration["constitution"],
              })}
            >
              <option value="council">Council</option>
              <option value="open-merge">Open Merge</option>
              <option value="elected-maintainer">Elected Maintainer</option>
            </select>
          </label>
          <label htmlFor="seed">
            Random seed
            <input
              id="seed"
              name="seed"
              type="number"
              min="0"
              step="1"
              value={configuration.seed}
              onChange={(event) => patch({ seed: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="disclosure-choice">
          <p>Disclosure policy</p>
          <label>
            <input
              type="radio"
              name="disclosurePolicy"
              value="clean-until-reveal"
              checked={configuration.disclosurePolicy === "clean-until-reveal"}
              onChange={() => patch({ disclosurePolicy: "clean-until-reveal" })}
            />
            <span><strong>Clean until reveal</strong> Private roles and beliefs stay sealed.</span>
          </label>
          <label>
            <input
              type="radio"
              name="disclosurePolicy"
              value="researcher-unblinded"
              checked={configuration.disclosurePolicy === "researcher-unblinded"}
              onChange={() => patch({ disclosurePolicy: "researcher-unblinded" })}
            />
            <span><strong>Researcher unblinded</strong> Marks the run benchmark-ineligible.</span>
          </label>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Resource limits</legend>
        <div className="limit-grid">
          {LIMIT_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <span className="number-field">
                <input
                  name={`limits.${field.key}`}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step="1"
                  value={configuration.limits[field.key]}
                  onChange={(event) => patchLimits({ [field.key]: Number(event.target.value) })}
                />
                <span>{field.unit}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
