import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only registers its automatic cleanup when Vitest globals are enabled, and
// this project keeps globals off. Without this, each render stays mounted and later queries
// find duplicate elements.
afterEach(cleanup);
