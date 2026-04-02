import type { NextApiRequest, NextApiResponse } from 'next';

function handler(req: NextApiRequest, res: NextApiResponse) {
  const primary = buildTeamList({ count: 3 });
  const secondary = buildTeamList({ count: 1 });
  res.status(200).json([...primary, ...secondary]);
}

export default handler;
