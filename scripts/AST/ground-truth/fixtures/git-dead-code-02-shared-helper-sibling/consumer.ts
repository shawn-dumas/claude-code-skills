/**
 * External consumer that imports through the barrel.
 * Only uses the re-exported query param builders, not shared helpers.
 */
import { getRealtimeStatsQueryParams, getMicroworkflowsQueryParams } from './index';

const realtimeParams = getRealtimeStatsQueryParams({ team: '1', timezone: -5 });
const microParams = getMicroworkflowsQueryParams({ teams: [1, 2, 3] });
