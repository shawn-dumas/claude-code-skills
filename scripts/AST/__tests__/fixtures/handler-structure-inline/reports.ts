import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { startDate, endDate, teamId } = req.body;

  const connection = await getConnection();
  const rawData = await connection.query('SELECT * FROM reports WHERE team_id = ? AND date BETWEEN ? AND ?', [
    teamId,
    startDate,
    endDate,
  ]);

  const filtered = rawData.filter((row: Record<string, unknown>) => row.active === true);
  const grouped: Record<string, unknown[]> = {};
  for (const row of filtered) {
    const key = String(row.category);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  const summary = Object.entries(grouped).map(([category, rows]) => ({
    category,
    count: rows.length,
    total: rows.reduce((sum, r) => sum + Number(r.amount), 0),
    average: rows.reduce((sum, r) => sum + Number(r.amount), 0) / rows.length,
  }));

  const sorted = summary.sort((a, b) => b.total - a.total);
  const topCategories = sorted.slice(0, 10);

  res.status(200).json({
    data: topCategories,
    metadata: {
      startDate,
      endDate,
      teamId,
      totalRecords: rawData.length,
      filteredRecords: filtered.length,
    },
  });
}

function getConnection(): Promise<{ query: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]> }> {
  return Promise.resolve({ query: async () => [] });
}

export default handler;
