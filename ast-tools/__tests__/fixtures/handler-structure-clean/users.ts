import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchUsers, formatUsers } from './users.logic';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const users = await fetchUsers();
  const result = formatUsers(users);
  res.status(200).json(result);
}

export default handler;
