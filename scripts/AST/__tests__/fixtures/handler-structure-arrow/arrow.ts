import type { NextApiRequest, NextApiResponse } from 'next';

// Handler defined as arrow function (exercises Node.isArrowFunction branch)
const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  /*
   * Multi-line block comment to exercise the inBlockComment path
   * in countNonTrivialLines (lines 97-109 in ast-handler-structure.ts)
   */
  const a = req.query.a;
  const b = req.query.b;
  const c = req.query.c;
  const d = req.query.d;
  const e = req.query.e;
  const f = req.query.f;
  const g = req.query.g;
  const h = req.query.h;
  const i = req.query.i;
  const j = req.query.j;
  const k = req.query.k;
  const l = req.query.l;
  const m = req.query.m;
  const n = req.query.n;
  const o = req.query.o;
  const p = req.query.p;
  res.status(200).json({ a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p });
};

export default handler;
