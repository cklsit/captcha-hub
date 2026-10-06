import type { CaptchaHubApi } from '../shared/types';

/**
 * Typed accessor for the preload bridge. The global `window.api` shape is
 * declared here so the whole renderer gets autocompletion and compile-time
 * safety for every IPC call.
 */

declare global {
  interface Window {
    api: CaptchaHubApi;
  }
}

export const api: CaptchaHubApi = window.api;
