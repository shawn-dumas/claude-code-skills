import React, { useState, useEffect, useContext, createContext } from 'react';

const DataContext = createContext<{ items: string[] }>({ items: [] });

interface Props {
  userId: string;
}

export function DerivedStatePanel({ userId }: Props) {
  const [userData, setUserData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const { items } = useContext(DataContext);
  const [filtered, setFiltered] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        setUserData(data);
        setLoading(false);
      });
  }, [userId]);

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/config');
      const data = await res.json();
      setUserData(data);
    };
    void load();
  }, []);

  useEffect(() => {
    setFiltered(items.filter(i => i.length > 0));
  }, [items]);

  return (
    <div>
      {loading ? 'Loading...' : String(userData)}
      {filtered.length}
    </div>
  );
}
