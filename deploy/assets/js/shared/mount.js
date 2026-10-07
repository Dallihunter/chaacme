// The single place client code turns a template result into DOM. It accepts only
// the output of html`` (everything interpolated was escaped when it was built) and
// parses it with DOMParser, so no script in it could ever run. There is no
// innerHTML anywhere in the client code; test/no-innerhtml.test.js enforces that.
import { isSafeHtml, toHtmlString } from './html.js';

export function toNodes(safe) {
  if (!isSafeHtml(safe)) throw new TypeError('mount() only accepts the output of html``');
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${toHtmlString(safe)}`, 'text/html');
  return Array.from(doc.body.childNodes);
}

/** Replaces the children of `root` with the rendered template. Returns root. */
export function mount(root, safe) {
  root.replaceChildren(...toNodes(safe));
  return root;
}
