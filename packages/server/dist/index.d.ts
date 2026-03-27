import { Window } from 'happy-dom';

declare const GLOBALS_KEYS: string[];
declare function installGlobals(window: Window): () => void;
declare function extractStateData(stateEl: any): Record<string, any>;
declare function renderToString(html: string): Promise<string>;

declare const VERSION: string;

export { GLOBALS_KEYS, VERSION, extractStateData, installGlobals, renderToString };
