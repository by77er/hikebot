/**
 * Self-tests of the page client against a stand-in for the Worker: a local
 * HTTP server that records the requests it receives and answers by path.
 * They check that the client returns a redirect as it came, keeps the
 * cookies it is given, sends them back and drops expired ones.
 */
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PageClient, stylesheetLinks } from "./harness/web";

interface Received {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const received: Received[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const path = req.url ?? "";
    received.push({
      method: req.method ?? "",
      path,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    if (path === "/sign-in") {
      res.writeHead(303, {
        Location: "/home",
        "Set-Cookie": [
          "session=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
          "theme=dark; Path=/",
        ],
      });
      res.end();
    } else if (path === "/sign-out") {
      res.writeHead(200, {
        "Set-Cookie": [
          "session=; Path=/; Max-Age=0",
          "theme=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        ],
      });
      res.end("signed out");
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<p>home</p>");
    }
  });
});
let base: URL;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = new URL(`http://127.0.0.1:${String(port)}/`);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

beforeEach(() => {
  received.length = 0;
});

describe("PageClient", () => {
  it("returns a redirect without following it", async () => {
    const page = await new PageClient(base).get("/sign-in");
    expect(page.status).toBe(303);
    expect(page.location?.href).toBe(new URL("/home", base).href);
    expect(received.map((r) => r.path)).toEqual(["/sign-in"]);
  });

  it("keeps the cookies it is given and sends them back", async () => {
    const client = new PageClient(base);
    await client.get("/sign-in");
    expect(Object.fromEntries(client.cookies)).toEqual({
      session: "abc",
      theme: "dark",
    });
    const page = await client.get("/home");
    expect(page).toMatchObject({ status: 200, body: "<p>home</p>" });
    expect(received[1]?.headers.cookie).toBe("session=abc; theme=dark");
  });

  it("drops cookies set to expire", async () => {
    const client = new PageClient(base);
    await client.get("/sign-in");
    await client.get("/sign-out");
    expect(client.cookies.size).toBe(0);
    await client.get("/home");
    expect(received[2]?.headers.cookie).toBeUndefined();
  });

  it("posts a form", async () => {
    await new PageClient(base).request("/settings", {
      form: { role: "Hikers & friends" },
    });
    expect(received[0]).toMatchObject({
      method: "POST",
      body: "role=Hikers+%26+friends",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  });

  it("finds the stylesheet links in a page", () => {
    expect(
      stylesheetLinks(
        '<head><link rel="icon" href="/i.png"/><link rel="stylesheet" href="/assets/app.css"/></head>',
      ),
    ).toEqual(["/assets/app.css"]);
  });
});
