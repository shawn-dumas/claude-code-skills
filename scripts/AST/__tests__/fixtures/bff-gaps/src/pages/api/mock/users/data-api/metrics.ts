import type { NextApiRequest, NextApiResponse } from 'next';

function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ count: 0 });
}

export default handler;
