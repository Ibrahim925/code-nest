import type {
  GovernanceBallotView,
  TownHallPass,
  TownHallTurnView,
  TownHallViewState,
} from "./domain/town-hall.js";

export interface TownHallProps {
  readonly state: TownHallViewState;
  readonly canInspectCitation: (eventId: string) => boolean;
  readonly onInspectCitation: (eventId: string) => void;
}

function passLabel(pass: TownHallPass): string {
  return pass === "evidence_accusation"
    ? "Pass 1 · Evidence and accusations"
    : "Pass 2 · Defence, rebuttal, and action";
}

function deadlineLabel(value: string): string {
  return `${value.slice(0, 10)} · ${value.slice(11, 19)} UTC`;
}

function DiscussionTurn({
  turn,
  canInspectCitation,
  onInspectCitation,
}: {
  readonly turn: TownHallTurnView;
  readonly canInspectCitation: TownHallProps["canInspectCitation"];
  readonly onInspectCitation: TownHallProps["onInspectCitation"];
}): React.JSX.Element {
  return (
    <article className="town-hall-turn">
      <header>
        <strong>{turn.participantId}</strong>
        <span>{turn.eventId}</span>
      </header>
      {turn.message === null
        ? <p className="turn-yield">Yielded this turn · no statement or citations</p>
        : <p className="turn-message">{turn.message.text}</p>}
      {turn.citations.length > 0 && (
        <ul className="citation-list" aria-label={`${turn.participantId} citations`}>
          {turn.citations.map((citation) => {
            const inspectable = citation.status !== "missing" && canInspectCitation(citation.eventId);
            return (
              <li key={citation.eventId}>
                <div>
                  <code>{citation.eventId}</code>
                  <span>{citation.claimedKind}</span>
                </div>
                <span className={`citation-status is-${citation.status}`}>
                  {citation.status}
                </span>
                <button
                  type="button"
                  disabled={!inspectable}
                  onClick={() => onInspectCitation(citation.eventId)}
                  aria-label={`Inspect citation ${citation.eventId}`}
                >{inspectable ? "Inspect evidence" : "Evidence unavailable"}</button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function PassColumn({
  pass,
  turns,
  canInspectCitation,
  onInspectCitation,
}: {
  readonly pass: TownHallPass;
  readonly turns: readonly TownHallTurnView[];
  readonly canInspectCitation: TownHallProps["canInspectCitation"];
  readonly onInspectCitation: TownHallProps["onInspectCitation"];
}): React.JSX.Element {
  const matching = turns.filter((turn) => turn.pass === pass);
  return (
    <section className="discussion-pass" aria-labelledby={`pass-${pass}`}>
      <h3 id={`pass-${pass}`}>{passLabel(pass)}</h3>
      {matching.length === 0
        ? <p className="pass-empty">No recorded turns in this pass yet.</p>
        : matching.map((turn) => (
          <DiscussionTurn
            key={turn.turnId}
            turn={turn}
            canInspectCitation={canInspectCitation}
            onInspectCitation={onInspectCitation}
          />
        ))}
    </section>
  );
}

function Ballot({ ballot }: { readonly ballot: GovernanceBallotView }): React.JSX.Element {
  const closed = ballot.status !== "open";
  return (
    <article className={`governance-ballot is-${ballot.status}`}>
      <header>
        <div>
          <span>{ballot.motionKind.replaceAll("_", " ")}</span>
          <h4>{ballot.motionSummary}</h4>
        </div>
        <strong>{ballot.status}</strong>
      </header>
      {ballot.motionDetail !== null && <p className="motion-detail">{ballot.motionDetail.text}</p>}
      <dl>
        <div><dt>Proposer</dt><dd>{ballot.proposerId}</dd></div>
        <div><dt>Approval rule</dt><dd>{ballot.requiredApprovals} of {ballot.eligibleVoterIds.length}</dd></div>
        <div><dt>{closed ? "Closed" : "Deadline"}</dt><dd>{deadlineLabel(ballot.closesAt)}</dd></div>
      </dl>
      {!closed ? (
        <div className="sealed-progress">
          <div><strong>Sealed ballot</strong><span>{ballot.votesSubmitted} of {ballot.eligibleVoterIds.length} submitted</span></div>
          <progress value={ballot.votesSubmitted} max={ballot.eligibleVoterIds.length} />
          <p>Choices remain private until closure.</p>
        </div>
      ) : (
        <ul className="published-votes" aria-label={`${ballot.motionId} published votes`}>
          {ballot.votes.map((vote) => (
            <li key={vote.voterId}>
              <span>{vote.voterId}</span>
              <strong>{vote.choice}</strong>
              {!vote.submitted && <small>automatic abstention · not submitted</small>}
            </li>
          ))}
        </ul>
      )}
      {ballot.authorizedEffect !== null && (
        <p className="authorized-effect">
          <strong>Authorized effect</strong> · {ballot.authorizedEffect}
          <small>Authority recorded; controller confirmation appears separately.</small>
        </p>
      )}
    </article>
  );
}

export function TownHall({
  state,
  canInspectCitation,
  onInspectCitation,
}: TownHallProps): React.JSX.Element | null {
  const hasContent = state.status !== "inactive" || state.ballots.length > 0 || state.outcomes.length > 0;
  if (!hasContent) return null;
  const latestOutcome = state.outcomes.at(-1);
  const latestClosedBallot = state.ballots.findLast(({ status }) => status !== "open");
  const governanceAnnouncement = latestOutcome === undefined
    ? latestClosedBallot === undefined
      ? "No closed governance outcome."
      : `Ballot ${latestClosedBallot.motionSummary} closed ${latestClosedBallot.status}.`
    : `Governance effect confirmed: ${latestOutcome.summary}`;
  return (
    <section className="town-hall" aria-labelledby="town-hall-title">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {governanceAnnouncement}
      </p>
      <header className="town-hall-heading">
        <div>
          <p className="section-kicker">Round {state.round ?? "—"} · Public governance record</p>
          <h2 id="town-hall-title">Town Hall</h2>
        </div>
        <div className="town-hall-now" aria-live="polite">
          <strong>{state.status}</strong>
          <span>{state.currentSpeakerId === null
            ? "Discussion closed"
            : `${state.currentSpeakerId} · ${state.activePass?.replaceAll("_", " ")}`}</span>
        </div>
      </header>

      {state.speakingOrder.length > 0 && (
        <ol className="speaking-order" aria-label="Town Hall speaking order">
          {state.speakingOrder.map((participantId, index) => (
            <li className={participantId === state.currentSpeakerId ? "is-current" : ""} key={participantId}>
              <span>{index + 1}</span>{participantId}
              {participantId === state.currentSpeakerId && <strong>Speaking now</strong>}
            </li>
          ))}
        </ol>
      )}

      <div className="discussion-grid">
        <PassColumn pass="evidence_accusation" turns={state.turns} canInspectCitation={canInspectCitation} onInspectCitation={onInspectCitation} />
        <PassColumn pass="defence_rebuttal" turns={state.turns} canInspectCitation={canInspectCitation} onInspectCitation={onInspectCitation} />
      </div>

      {(state.ballots.length > 0 || state.outcomes.length > 0) && (
        <section className="governance-record" aria-labelledby="governance-title">
          <header><h3 id="governance-title">Motions and effects</h3><span>Votes publish only after closure</span></header>
          <div className="ballot-grid">{state.ballots.map((item) => <Ballot ballot={item} key={item.motionId} />)}</div>
          {state.outcomes.length > 0 && (
            <ol className="outcome-ledger" aria-label="Controller-confirmed governance effects">
              {state.outcomes.map((item) => (
                <li key={item.id}>
                  <strong>{item.kind === "credits_spent" ? "Credits spent" : "Effect confirmed"}</strong>
                  <span>{item.summary}</span>
                  {item.cost !== null && <span>Cost {item.cost} · {item.remainingCredits} remaining</span>}
                  <code>{item.eventId}</code>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}
