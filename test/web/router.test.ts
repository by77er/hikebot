import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { WebRouter, type WebHandler } from "../../src/web/router";

function text(body: string): WebHandler {
  return () => new Response(body, { headers: { "X-Route": body } });
}

function router(): WebRouter {
  return new WebRouter({
    notFound: () => new Response("not found", { status: 404 }),
    methodNotAllowed: (allow) =>
      new Response(`not allowed, use ${allow}`, { status: 405 }),
  })
    .get("/", text("home"))
    .get("/settings", text("settings"))
    .post("/settings", text("saved"))
    .post("/form", text("posted"))
    .get("/assets/*", text("asset"))
    .get("/assets/icons/*", text("icon"))
    .get("/assets/exact.css", text("exact"));
}

async function call(
  path: string,
  method = "GET",
): Promise<{ status: number; body: string; allow: string | null }> {
  const response = await router().handle(
    new Request(`https://hikebot.example${path}`, { method }),
    env,
    createExecutionContext(),
  );
  return {
    status: response.status,
    body: await response.text(),
    allow: response.headers.get("Allow"),
  };
}

describe("WebRouter", () => {
  it("routes by method and exact path", async () => {
    expect(await call("/")).toMatchObject({ status: 200, body: "home" });
    expect(await call("/settings")).toMatchObject({ body: "settings" });
    expect(await call("/settings", "POST")).toMatchObject({ body: "saved" });
    expect(await call("/form", "POST")).toMatchObject({ body: "posted" });
  });

  it("answers a path with no route with notFound", async () => {
    for (const path of ["/nope", "/settings/", "/Settings", "/assets"]) {
      expect(await call(path), path).toEqual({
        status: 404,
        body: "not found",
        allow: null,
      });
    }
  });

  it("answers a wrong method with 405 and Allow", async () => {
    expect(await call("/", "POST")).toEqual({
      status: 405,
      body: "not allowed, use GET, HEAD",
      allow: "GET, HEAD",
    });
    expect(await call("/settings", "DELETE")).toMatchObject({
      status: 405,
      allow: "GET, POST, HEAD",
    });
    expect(await call("/form", "GET")).toMatchObject({
      status: 405,
      allow: "POST",
    });
  });

  it("answers HEAD from the GET route, with its headers and no body", async () => {
    const response = await router().handle(
      new Request("https://hikebot.example/settings", { method: "HEAD" }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Route")).toBe("settings");
    expect(await response.text()).toBe("");
    expect(await call("/nope", "HEAD")).toMatchObject({
      status: 404,
      body: "",
    });
    expect(await call("/form", "HEAD")).toMatchObject({
      status: 405,
      body: "",
      allow: "POST",
    });
  });

  it("matches a path ending in /* as a prefix, exact and longer first", async () => {
    expect(await call("/assets/app.css")).toMatchObject({ body: "asset" });
    expect(await call("/assets/")).toMatchObject({ body: "asset" });
    expect(await call("/assets/icons/a.svg")).toMatchObject({ body: "icon" });
    expect(await call("/assets/exact.css")).toMatchObject({ body: "exact" });
  });

  it("lists the paths of each method in the order they were added", () => {
    expect(router().paths("GET")).toEqual([
      "/",
      "/settings",
      "/assets/*",
      "/assets/icons/*",
      "/assets/exact.css",
    ]);
    expect(router().paths("POST")).toEqual(["/settings", "/form"]);
  });

  it("refuses a route registered twice or without a leading slash", () => {
    expect(() => router().get("/", text("again"))).toThrow(/registered twice/);
    expect(() => router().get("settings", text("x"))).toThrow(/start with \//);
  });
});
