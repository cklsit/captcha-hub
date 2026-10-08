import sanitizeHtml from 'sanitize-html';

/**
 * HTML body sanitiser.
 *
 * Mail is untrusted input: the reading pane is the one place a hostile sender
 * could otherwise reach the user. This runs in the MAIN process and strips
 * everything that can execute or phone home — `<script>`, `<iframe>`,
 * `<object>`, `on*` handlers, `javascript:` URLs — while keeping the layout
 * tags real mail relies on. Remote images are blocked by default and can be
 * re-enabled per mail via the "show external images" toggle.
 *
 * Pure module: no Electron import, so it is unit-testable under plain Node.
 */

export interface SanitizeOptions {
  /** When false (default) remote `http(s)` images are neutralised. */
  allowRemoteImages?: boolean;
}

/** Tags that carry no execution risk and are common in real mail. */
const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote', 'br', 'caption',
  'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'main', 'mark',
  'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var',
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*': ['style', 'title', 'align', 'valign', 'dir', 'lang', 'width', 'height', 'bgcolor'],
  a: ['href', 'name', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'width', 'height', 'title'],
  font: ['color', 'face', 'size'],
  table: ['border', 'cellpadding', 'cellspacing', 'width', 'bgcolor', 'align'],
  td: ['colspan', 'rowspan', 'width', 'height', 'bgcolor', 'align', 'valign'],
  th: ['colspan', 'rowspan', 'width', 'height', 'bgcolor', 'align', 'valign'],
};

const REMOTE_URL = /^(https?:)?\/\//i;

/** `url(...)` inside inline styles pointing at a remote host. */
const REMOTE_CSS_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;

function stripAlphaImages(attribs: Record<string, string>): Record<string, string> {
  const next = { ...attribs };
  const src = next.src ?? '';
  // Remote images and `cid:` references to attachments are both dropped; only
  // inline `data:` URIs survive when external images are disabled.
  if (REMOTE_URL.test(src) || /^cid:/i.test(src)) {
    delete next.src;
    delete next.srcset;
  }
  delete next.srcset;
  return next;
}

/**
 * Sanitizes a mail's HTML body into a string that is safe to inject into a
 * sandboxed iframe (`srcdoc`).
 */
export function sanitizeMailHtml(html: string, options: SanitizeOptions = {}): string {
  const allowRemoteImages = options.allowRemoteImages ?? false;

  const cleaned = sanitizeHtml(html ?? '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: allowRemoteImages ? ['http', 'https', 'data'] : ['data'] },
    disallowedTagsMode: 'discard',
    // Drop the *content* of these outright rather than unwrapping it.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: allowRemoteImages ? { ...attribs } : stripAlphaImages(attribs),
      }),
    },
  });

  // Neutralise remote assets smuggled in via CSS (background-image …).
  return allowRemoteImages ? cleaned : cleaned.replace(REMOTE_CSS_URL, 'none');
}
