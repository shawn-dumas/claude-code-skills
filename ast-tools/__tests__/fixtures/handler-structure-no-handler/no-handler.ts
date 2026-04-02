import type { NextApiRequest, NextApiResponse } from 'next';

// Default export is a const arrow function (not a named function declaration).
// sf.getFunctions() returns function declarations only, not arrow functions.
// So findHandlerFunction will: (1) not find 'handler' function, (2) not find
// const handler = ..., (3) find a defaultExport symbol, (4) loop sf.getFunctions()
// which yields nothing (no function declarations), and (5) return null (line 76).
const apiRoute = async (req: NextApiRequest, res: NextApiResponse) => {
  res.status(200).json({ ok: true });
};

export default apiRoute;
