/* eslint-disable */
import React from 'react';

interface Entity {
  id: string;
  name: string;
}

interface Props {
  useEntityQuery: () => { data: Entity[] };
  useCreateMutation: () => { mutate: (data: Entity) => void };
  title: string;
}

export function EntityManager({ useEntityQuery, useCreateMutation, title }: Props) {
  const { data } = useEntityQuery();
  const { mutate } = useCreateMutation();
  return (
    <div>
      {title}: {data?.length} <button onClick={() => mutate({} as Entity)}>Add</button>
    </div>
  );
}
