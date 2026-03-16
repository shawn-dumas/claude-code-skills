import { useCallback, useEffect, useRef, useState } from 'react';

interface WorkstreamItem {
  workstream_value: string;
  name: string;
}

interface Props {
  data: WorkstreamItem[] | undefined;
}

export function AutoSelectContainer({ data }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setAzWs = useCallback((value: string | null) => setSelectedId(value), []);

  const prevDataRef = useRef(data);

  useEffect(() => {
    if (prevDataRef.current === data) return;
    prevDataRef.current = data;

    if (data?.length === 1) {
      void setAzWs(data[0].workstream_value);
    }
  }, [data, setAzWs]);

  return <div>{selectedId ?? 'none'}</div>;
}
