import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // NOTE: stub endpoint, needs implementation
  res.status(501).json({ error: 'Not implemented' });
}

export default withAuth(handler);
