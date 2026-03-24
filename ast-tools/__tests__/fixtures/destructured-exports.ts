// Destructured variable exports: export const { a, b } = ...
const config = { host: 'localhost', port: 3000, debug: false };

export const { host, port, debug } = config;

// Regular export alongside for comparison
export const REGULAR = 'regular';
