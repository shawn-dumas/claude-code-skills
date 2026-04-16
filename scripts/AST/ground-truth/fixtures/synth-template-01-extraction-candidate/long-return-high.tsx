import React from 'react';

interface MetricRow {
  id: string;
  label: string;
  value: number;
  trend: 'up' | 'down' | 'flat';
  category: string;
}

interface Props {
  metrics: MetricRow[];
  dateRange: string;
  onRefresh: () => void;
}

export function AnalyticsDashboard({ metrics, dateRange, onRefresh }: Props) {
  return (
    <div className='analytics-dashboard'>
      <header className='analytics-header'>
        <h1>Analytics Overview</h1>
        <span className='date-range'>{dateRange}</span>
        <button type='button' onClick={onRefresh}>
          Refresh
        </button>
      </header>
      <section className='summary-cards'>
        <div className='card'>
          <h3>Total Metrics</h3>
          <p>{metrics.length}</p>
        </div>
        <div className='card'>
          <h3>Trending Up</h3>
          <p>{metrics.filter(m => m.trend === 'up').length}</p>
        </div>
        <div className='card'>
          <h3>Trending Down</h3>
          <p>{metrics.filter(m => m.trend === 'down').length}</p>
        </div>
        <div className='card'>
          <h3>Flat</h3>
          <p>{metrics.filter(m => m.trend === 'flat').length}</p>
        </div>
      </section>
      <section className='chart-area'>
        <div className='chart-placeholder'>
          <p>Chart: {dateRange}</p>
          <div className='chart-bars'>
            {metrics.map(m => (
              <div key={m.id} className='bar' style={{ height: `${m.value}%` }}>
                <span className='bar-label'>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className='detailed-table'>
        <h2>Detailed Breakdown</h2>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Value</th>
              <th>Trend</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(row => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td>{row.value}</td>
                <td>
                  <span className='trend-indicator'>
                    {row.trend === 'up' && 'Rising'}
                    {row.trend === 'down' && 'Falling'}
                    {row.trend === 'flat' && 'Steady'}
                  </span>
                </td>
                <td>{row.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className='category-breakdown'>
        <h2>By Category</h2>
        <div className='category-grid'>
          <div className='category-card'>
            <h4>Performance</h4>
            <ul>
              {metrics
                .filter(m => m.category === 'performance')
                .map(m => (
                  <li key={m.id}>
                    {m.label}: {m.value}
                  </li>
                ))}
            </ul>
          </div>
          <div className='category-card'>
            <h4>Engagement</h4>
            <ul>
              {metrics
                .filter(m => m.category === 'engagement')
                .map(m => (
                  <li key={m.id}>
                    {m.label}: {m.value}
                  </li>
                ))}
            </ul>
          </div>
          <div className='category-card'>
            <h4>Revenue</h4>
            <ul>
              {metrics
                .filter(m => m.category === 'revenue')
                .map(m => (
                  <li key={m.id}>
                    {m.label}: {m.value}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>
      <section className='export-section'>
        <h2>Export Options</h2>
        <div className='export-buttons'>
          <button type='button'>Download CSV</button>
          <button type='button'>Download PDF</button>
          <button type='button'>Email Report</button>
          <button type='button'>Schedule Report</button>
        </div>
        <div className='export-info'>
          <p>Reports include all metrics for {dateRange}</p>
          <p>Last generated: today</p>
        </div>
      </section>
      <section className='alerts-section'>
        <h2>Active Alerts</h2>
        <div className='alert-list'>
          <div className='alert-item'>
            <span className='alert-icon'>Warning</span>
            <span className='alert-message'>3 metrics below threshold</span>
          </div>
          <div className='alert-item'>
            <span className='alert-icon'>Info</span>
            <span className='alert-message'>New category added this week</span>
          </div>
        </div>
      </section>
      <section className='notes-section'>
        <h2>Notes</h2>
        <div className='notes-list'>
          <div className='note'>
            <p>Data refreshed hourly from source systems</p>
          </div>
          <div className='note'>
            <p>Trends calculated over rolling 7-day window</p>
          </div>
          <div className='note'>
            <p>Categories assigned by data team classification</p>
          </div>
        </div>
      </section>
      <section className='feedback-section'>
        <h2>Feedback</h2>
        <div className='feedback-form'>
          <p>How useful was this report?</p>
          <div className='rating-buttons'>
            <button type='button'>Not useful</button>
            <button type='button'>Somewhat</button>
            <button type='button'>Very useful</button>
          </div>
        </div>
      </section>
      <footer className='analytics-footer'>
        <div className='footer-meta'>
          <span>Version 2.1</span>
          <span>Updated: {dateRange}</span>
        </div>
        <div className='footer-links'>
          <a href='/help'>Help</a>
          <a href='/docs'>Docs</a>
          <a href='/changelog'>Changelog</a>
          <a href='/api'>API</a>
        </div>
      </footer>
    </div>
  );
}
