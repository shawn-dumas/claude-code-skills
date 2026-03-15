/**
 * Fixture: before version of a component for refactor intent tests.
 * Contains a container component with hooks that will be split into
 * two files (container + block) in the after version.
 */
import { useState, useEffect, useMemo } from 'react';

interface DashboardProps {
  teamId: string;
  onNavigate: (path: string) => void;
}

function Dashboard({ teamId, onNavigate }: DashboardProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = `Dashboard - ${teamId}`;
  }, [teamId]);

  const doubled = useMemo(() => count * 2, [count]);

  const handleClick = () => {
    setCount(prev => prev + 1);
    onNavigate('/details');
  };

  return (
    <div>
      <h1>Dashboard for {teamId}</h1>
      <p>Count: {count}</p>
      <p>Doubled: {doubled}</p>
      <button onClick={handleClick}>Navigate</button>
    </div>
  );
}

export { Dashboard };
