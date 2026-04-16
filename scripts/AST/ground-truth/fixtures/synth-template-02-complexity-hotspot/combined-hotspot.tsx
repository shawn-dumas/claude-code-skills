import React from 'react';

interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: 'low' | 'medium' | 'high';
  assignee: string | null;
}

interface Props {
  tasks: Task[];
  isAdmin: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onNotify: (msg: string) => void;
}

export function TaskBoard({ tasks, isAdmin, onToggle, onDelete, onNotify }: Props) {
  return (
    <div className='task-board'>
      <h2>Tasks ({tasks.length})</h2>
      {isAdmin && (
        <div className='admin-bar'>
          <span>Admin mode active</span>
        </div>
      )}
      {tasks
        .filter(t => !t.done)
        .map(task => (
          <div key={task.id} className='task-card'>
            <span>{task.title}</span>
            <span>{task.priority === 'high' ? 'Urgent' : task.priority === 'medium' ? 'Normal' : 'Low'}</span>
            {task.assignee && <span>Assigned: {task.assignee}</span>}
            <button
              type='button'
              onClick={() => {
                onToggle(task.id);
                const remaining = tasks.filter(t => !t.done).length - 1;
                if (remaining === 0) {
                  onNotify('All tasks complete');
                }
                onDelete(task.id);
              }}
            >
              Complete
            </button>
          </div>
        ))}
    </div>
  );
}
