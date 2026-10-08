/**
 * Renderer-side HTML plumbing for the reading pane.
 *
 * The body arrives already sanitized by the main process; wrapping it in a
 * `srcdoc` document adds the second half of the defence: a CSP that forbids
 * scripts, forms and any network access beyond what the user opted into, and a
 * `<base target="_blank">` so links open in the system browser instead of
 * navigating the sandbox.
 */

export interface IframeOptions {
  allowRemoteImages: boolean;
}

const BASE_STYLE = `
  html,body { margin:0; padding:16px; }
  body { font-family: 'Segoe UI','Microsoft YaHei',system-ui,sans-serif; font-size:14px; line-height:1.6; word-break:break-word; }
  img { max-width:100%; height:auto; }
  table { max-width:100%; }
  a { color:#5b8cff; }
`;

/** Builds the `srcdoc` value for the sandboxed reading-pane iframe. */
export function buildIframeSrcDoc(html: string, options: IframeOptions): string {
  const imgSrc = options.allowRemoteImages ? "img-src data: https: http:" : "img-src data:";
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    imgSrc,
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ');

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<base target="_blank">',
    `<style>${BASE_STYLE}</style>`,
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
}
