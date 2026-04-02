import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // TODO: Implement this endpoint fully
  res.status(501).json({ error: 'Not implemented' });
}

export default withErrorHandler(withMethod(['GET'], withAuth(handler)));
