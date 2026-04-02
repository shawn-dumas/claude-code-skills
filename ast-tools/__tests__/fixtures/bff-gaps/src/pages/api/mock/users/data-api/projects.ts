import type { NextApiRequest, NextApiResponse } from 'next';

function handler(req: NextApiRequest, res: NextApiResponse) {
  const data = buildProjectList({ count: 5 });
  res.status(200).json(data);
}

export default handler;
