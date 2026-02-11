import { IConfig } from "./types.js";

export const config: IConfig = {

  bindAttributeName: 'data-bind-state',
  commentTextPrefix: 'wcs-text',
  commentForPrefix: 'wcs-for',
  commentIfPrefix: 'wcs-if',
  commentElseIfPrefix: 'wcs-elseif',
  commentElsePrefix: 'wcs-else',
  tagNames: {
    state: 'wcs-state',
  },
  locale: 'en',
  debug: false,
  enableMustache: true,
};