/**
 * Fixture: after version -- container component (split from before).
 * The hooks stay here, but JSX is delegated to DashboardBlock.
 */
import { useState, useEffect, useMemo } from 'react';
import { DashboardBlock } from './refactor-intent-after-block';

interface DashboardContainerProps {
  teamId: string;
  onNavigate: (path: string) => void;
}

function DashboardContainer({ teamId, onNavigate }: DashboardContainerProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = `Dashboard - ${teamId}`;
  }, [teamId]);

  const doubled = useMemo(() => count * 2, [count]);

  const handleClick = () => {
    setCount(prev => prev + 1);
    onNavigate('/details');
  };

  return <DashboardBlock teamId={teamId} count={count} doubled={doubled} onButtonClick={handleClick} />;
}

export { DashboardContainer };
