'use client';
import { createContext } from 'react';

// React context reaches body portals without moving or remounting their children.
// Other role layouts retain their current behavior through the visible default.
export const PilotVisibility = createContext(true);
