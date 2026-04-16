import React from 'react';

interface FormData {
  name: string;
  email: string;
}

interface Props {
  initialData: FormData;
  onSave: (data: FormData) => void;
  onError: (msg: string) => void;
}

export function InlineFormPanel({ initialData, onSave, onError }: Props) {
  return (
    <div className='form-panel'>
      <h2>Edit Profile</h2>
      <form>
        <label htmlFor='name'>Name</label>
        <input id='name' defaultValue={initialData.name} />
        <label htmlFor='email'>Email</label>
        <input id='email' defaultValue={initialData.email} />
        <button
          type='button'
          onClick={e => {
            e.preventDefault();
            const form = e.currentTarget.closest('form');
            if (!form) return;
            const nameInput = form.querySelector<HTMLInputElement>('#name');
            const emailInput = form.querySelector<HTMLInputElement>('#email');
            if (!nameInput?.value || !emailInput?.value) {
              onError('All fields are required');
              return;
            }
            onSave({ name: nameInput.value, email: emailInput.value });
          }}
        >
          Save Changes
        </button>
      </form>
    </div>
  );
}
