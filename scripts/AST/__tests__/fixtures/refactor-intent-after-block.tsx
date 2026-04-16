/**
 * Fixture: after version -- presentational block (split from before).
 * Pure component receiving all data via props.
 */

interface DashboardBlockProps {
  teamId: string;
  count: number;
  doubled: number;
  onButtonClick: () => void;
}

function DashboardBlock({ teamId, count, doubled, onButtonClick }: DashboardBlockProps) {
  return (
    <div>
      <h1>Dashboard for {teamId}</h1>
      <p>Count: {count}</p>
      <p>Doubled: {doubled}</p>
      <button onClick={onButtonClick}>Navigate</button>
    </div>
  );
}

export { DashboardBlock };
