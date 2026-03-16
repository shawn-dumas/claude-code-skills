import { useEffect, useMemo, useState } from 'react';

interface WorkstreamData {
  id: string;
  name: string;
}

function getRowSelectionState(selected: WorkstreamData[], all: WorkstreamData[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  selected.forEach(s => {
    const idx = all.findIndex(a => a.id === s.id);
    if (idx >= 0) map[String(idx)] = true;
  });
  return map;
}

interface Props {
  workstreams: WorkstreamData[];
  selectedWorkstreams: WorkstreamData[];
}

export function WorkstreamsTableExtract({ workstreams, selectedWorkstreams }: Props) {
  const initialRowSelection = useMemo(
    () => getRowSelectionState(selectedWorkstreams, workstreams),
    [selectedWorkstreams, workstreams],
  );

  const [rowSelection, setRowSelection] = useState(initialRowSelection);

  useEffect(() => {
    setRowSelection(initialRowSelection);
  }, [initialRowSelection]);

  return <div>{JSON.stringify(rowSelection)}</div>;
}
