import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const items = await fetchItems();
    res.status(200).json(items);
  } else if (req.method === 'POST') {
    const created = await createItem(req.body);
    res.status(201).json(created);
  } else if (req.method === 'DELETE') {
    await deleteItem(req.body.id);
    res.status(204).end();
  } else {
    res.status(405).end();
  }
}

async function fetchItems(): Promise<string[]> {
  return ['item1', 'item2'];
}

async function createItem(body: unknown): Promise<{ id: string }> {
  return { id: 'new' };
}

async function deleteItem(id: string): Promise<void> {
  // no-op
}

export default handler;
