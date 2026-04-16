import React from 'react';

// Named interface
interface BaseProps {
  id: string;
  name: string;
}

// Extended interface
interface ExtendedProps extends BaseProps {
  email?: string;
  onSave: (data: Record<string, unknown>) => void;
}

// Intersection type
type CombinedProps = ExtendedProps & {
  isActive: boolean;
  children: React.ReactNode;
};

// Component with inline type
export function InlineComponent({ label, count = 0 }: { label: string; count?: number }) {
  return (
    <div>
      {label}: {count}
    </div>
  );
}

// Component with named interface
export function NamedComponent({ id, name }: BaseProps) {
  return (
    <div>
      {id}: {name}
    </div>
  );
}

// Component with extended interface
export function ExtendedComponent({ id, name, email, onSave }: ExtendedProps) {
  return (
    <div onClick={() => onSave({ id, name })}>
      {id}: {name} ({email})
    </div>
  );
}

// Component with intersection type
export function CombinedComponent({ id, name, email, onSave, isActive, children }: CombinedProps) {
  return (
    <div onClick={() => onSave({ id, name })}>
      {id}: {name} ({email}) {isActive ? 'active' : 'inactive'}
      {children}
    </div>
  );
}
