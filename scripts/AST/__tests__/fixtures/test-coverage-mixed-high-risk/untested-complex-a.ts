/**
 * An untested file with high cyclomatic complexity.
 * No dedicated spec, not imported by any spec.
 */
export function transformRecords(
  records: Array<{ type: string; value: number; status: string; priority?: number }>,
  options: { strict: boolean; threshold: number; includeArchived: boolean },
): Array<{ label: string; score: number; category: string }> {
  const results: Array<{ label: string; score: number; category: string }> = [];

  for (const record of records) {
    if (record.status === 'archived' && !options.includeArchived) {
      continue;
    }

    let score = record.value;
    let category = 'unknown';

    if (record.type === 'alpha') {
      if (record.priority && record.priority > 5) {
        score = score * 2;
        category = 'high-priority-alpha';
      } else if (record.priority && record.priority > 2) {
        score = score * 1.5;
        category = 'medium-priority-alpha';
      } else {
        category = 'low-priority-alpha';
      }
    } else if (record.type === 'beta') {
      if (record.status === 'active') {
        score = score + 10;
        category = 'active-beta';
      } else if (record.status === 'pending') {
        score = score + 5;
        category = 'pending-beta';
      } else {
        category = 'inactive-beta';
      }
    } else if (record.type === 'gamma') {
      if (options.strict) {
        if (record.value > options.threshold) {
          score = record.value;
          category = 'above-threshold-gamma';
        } else {
          score = 0;
          category = 'below-threshold-gamma';
        }
      } else {
        score = Math.max(record.value, options.threshold);
        category = 'lenient-gamma';
      }
    } else {
      if (record.status === 'active') {
        category = 'active-other';
      } else {
        category = 'inactive-other';
      }
    }

    if (score < 0) {
      score = 0;
    }

    results.push({
      label: `${record.type}-${record.status}`,
      score,
      category,
    });
  }

  return results;
}

export function aggregateScores(
  items: Array<{ score: number; category: string }>,
): Record<string, { total: number; count: number; avg: number }> {
  const byCategory: Record<string, { total: number; count: number }> = {};

  for (const item of items) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = { total: 0, count: 0 };
    }
    byCategory[item.category].total += item.score;
    byCategory[item.category].count++;
  }

  const result: Record<string, { total: number; count: number; avg: number }> = {};
  for (const [cat, data] of Object.entries(byCategory)) {
    result[cat] = {
      total: data.total,
      count: data.count,
      avg: data.count > 0 ? data.total / data.count : 0,
    };
  }

  return result;
}
