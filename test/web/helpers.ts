/** What a page's HTML holds, read with the runtime's HTMLRewriter. */
export interface PageOutline {
  doctype: string | null;
  lang: string | null;
  title: string;
  viewport: string | null;
  stylesheets: string[];
  /** The `href` of the first link in the body. */
  firstLink: string | null;
  mainId: string | null;
  /** Element names in document order, such as `header`, `main`. */
  elements: string[];
  scripts: number;
  styleElements: number;
  styleAttributes: number;
  eventAttributes: number;
  text: string;
}

export async function outline(html: string): Promise<PageOutline> {
  const page: PageOutline = {
    doctype: null,
    lang: null,
    title: "",
    viewport: null,
    stylesheets: [],
    firstLink: null,
    mainId: null,
    elements: [],
    scripts: 0,
    styleElements: 0,
    styleAttributes: 0,
    eventAttributes: 0,
    text: "",
  };
  let inBody = false;
  await new HTMLRewriter()
    .onDocument({
      doctype(doctype) {
        page.doctype = doctype.name;
      },
      text(text) {
        page.text += text.text;
      },
    })
    .on("*", {
      element(element) {
        page.elements.push(element.tagName);
        if (element.tagName === "body") inBody = true;
        if (element.tagName === "script") page.scripts += 1;
        if (element.tagName === "style") page.styleElements += 1;
        for (const [name = ""] of element.attributes) {
          if (name === "style") page.styleAttributes += 1;
          if (name.startsWith("on")) page.eventAttributes += 1;
        }
      },
    })
    .on("html", {
      element(element) {
        page.lang = element.getAttribute("lang");
      },
    })
    .on("title", {
      text(text) {
        page.title += text.text;
      },
    })
    .on('meta[name="viewport"]', {
      element(element) {
        page.viewport = element.getAttribute("content");
      },
    })
    .on('link[rel="stylesheet"]', {
      element(element) {
        page.stylesheets.push(element.getAttribute("href") ?? "");
      },
    })
    .on("a[href]", {
      element(element) {
        if (inBody && page.firstLink === null) {
          page.firstLink = element.getAttribute("href");
        }
      },
    })
    .on("main", {
      element(element) {
        page.mainId = element.getAttribute("id");
      },
    })
    .transform(new Response(html))
    .text();
  return page;
}

/** The headers every HTML response must carry, written out in full. */
export const EXPECTED_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data: https://cdn.discordapp.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "cache-control": "no-store",
};

/** The response's values of the headers in `EXPECTED_PAGE_HEADERS`. */
export function pageHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    Object.keys(EXPECTED_PAGE_HEADERS).map((name) => [
      name,
      response.headers.get(name) ?? "(missing)",
    ]),
  );
}
