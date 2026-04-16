import React from 'react';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  active: boolean;
}

interface Props {
  members: TeamMember[];
  title: string;
  showFilters: boolean;
  onSelect: (id: string) => void;
}

export function TeamDashboardPanel({ members, title, showFilters, onSelect }: Props) {
  return (
    <div className='team-dashboard'>
      <header className='dashboard-header'>
        <h1>{title}</h1>
        <p>Total members: {members.length}</p>
      </header>
      {showFilters && (
        <div className='filters-section'>
          <label htmlFor='search'>Search</label>
          <input id='search' type='text' placeholder='Search members...' />
          <label htmlFor='dept'>Department</label>
          <select id='dept'>
            <option value=''>All</option>
            <option value='eng'>Engineering</option>
            <option value='design'>Design</option>
            <option value='pm'>Product</option>
          </select>
        </div>
      )}
      <div className='stats-bar'>
        <div className='stat-card'>
          <span className='stat-label'>Active</span>
          <span className='stat-value'>{members.filter(m => m.active).length}</span>
        </div>
        <div className='stat-card'>
          <span className='stat-label'>Inactive</span>
          <span className='stat-value'>{members.filter(m => !m.active).length}</span>
        </div>
        <div className='stat-card'>
          <span className='stat-label'>Departments</span>
          <span className='stat-value'>{new Set(members.map(m => m.department)).size}</span>
        </div>
      </div>
      <table className='members-table'>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Department</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map(member => (
            <tr key={member.id} className={member.active ? 'active-row' : 'inactive-row'}>
              <td>
                <div className='member-name'>
                  <span className='avatar'>{member.name.charAt(0)}</span>
                  <span>{member.name}</span>
                </div>
              </td>
              <td>{member.email}</td>
              <td>
                <span className='role-badge'>{member.role}</span>
              </td>
              <td>{member.department}</td>
              <td>
                <span className={member.active ? 'status-active' : 'status-inactive'}>
                  {member.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td>
                <button type='button' onClick={() => onSelect(member.id)}>
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className='pagination-section'>
        <div className='page-info'>
          <span>Showing {members.length} members</span>
        </div>
        <div className='page-controls'>
          <button type='button' disabled>
            Previous
          </button>
          <span className='page-number'>1</span>
          <button type='button' disabled>
            Next
          </button>
        </div>
      </div>
      <footer className='dashboard-footer'>
        <div className='footer-info'>
          <span>Last updated: today</span>
          <span>Version 1.0</span>
        </div>
        <div className='footer-actions'>
          <button type='button'>Export CSV</button>
          <button type='button'>Print Report</button>
        </div>
        <div className='footer-links'>
          <a href='/help'>Help</a>
          <a href='/docs'>Documentation</a>
          <a href='/support'>Support</a>
        </div>
        <div className='footer-legal'>
          <span>Copyright 2026</span>
          <a href='/privacy'>Privacy Policy</a>
          <a href='/terms'>Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}
