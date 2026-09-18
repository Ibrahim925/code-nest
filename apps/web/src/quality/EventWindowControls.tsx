import {
  nextEventWindowEnd,
  previousEventWindowEnd,
  type EventWindow,
} from "./domain/event-window.js";

export interface EventWindowControlsProps {
  readonly label: string;
  readonly window: EventWindow<unknown>;
  readonly onWindowEndChange: (end: number | null) => void;
}

function positionLabel(window: EventWindow<unknown>): string {
  if (window.total === 0) return "No events";
  return `Events ${window.start + 1}–${window.end} of ${window.total}`;
}

export function EventWindowControls({
  label,
  window,
  onWindowEndChange,
}: EventWindowControlsProps): React.JSX.Element | null {
  if (window.total <= window.size) return null;
  return (
    <nav className="event-window-controls" aria-label={`${label} event navigation`}>
      <button
        type="button"
        disabled={window.hiddenBefore === 0}
        onClick={() => onWindowEndChange(previousEventWindowEnd(window))}
      >Older events</button>
      <output aria-live="polite" aria-atomic="true">
        {positionLabel(window)}
        <small>Only this window is rendered for performance.</small>
      </output>
      <button
        type="button"
        disabled={window.hiddenAfter === 0}
        onClick={() => {
          const nextEnd = nextEventWindowEnd(window);
          onWindowEndChange(nextEnd === window.total ? null : nextEnd);
        }}
      >Newer events</button>
    </nav>
  );
}
