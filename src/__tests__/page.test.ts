/**
 * Tests for the parsers that turn browser-operation output into typed data.
 *
 * The fixtures below are the assistant's real wire format: a snapshot is the
 * accessibility listing wrapped in an `<external_content>` fence whose `origin`
 * attribute names the page. Getting these wrong is silent — an element line
 * that fails to parse just disappears from the app's rail — so the shape is
 * pinned here rather than trusted.
 */

import { describe, expect, test } from "bun:test";

import {
  parseExtract,
  parseNavigate,
  parseSnapshot,
  parseStatus,
  unwrapFence,
} from "../page.js";

const SNAPSHOT = `<external_content source="web" origin="https://example.com/">
URL: https://example.com/
Title: Example Domain

[e1] <link href="https://www.iana.org/domains/example"> More information...
[e2] <textbox placeholder="Search" value="cats"> Search the site
[e3] <button>

1 interactive element found.
</external_content>`;

describe("unwrapFence", () => {
  test("strips the fence and reports the origin", () => {
    const { body, origin } = unwrapFence(
      '<external_content source="web" origin="https://a.test/x">hello</external_content>',
    );
    expect(body).toBe("hello");
    expect(origin).toBe("https://a.test/x");
  });

  test("passes unfenced content through with no origin", () => {
    const { body, origin } = unwrapFence("  plain text  ");
    expect(body).toBe("plain text");
    expect(origin).toBeNull();
  });

  test("keeps a fence with no origin attribute", () => {
    const { body, origin } = unwrapFence(
      '<external_content source="web">body</external_content>',
    );
    expect(body).toBe("body");
    expect(origin).toBeNull();
  });
});

describe("parseSnapshot", () => {
  test("reads the page headers", () => {
    const snapshot = parseSnapshot(SNAPSHOT);
    expect(snapshot.url).toBe("https://example.com/");
    expect(snapshot.title).toBe("Example Domain");
  });

  test("parses every element line, including one with no name", () => {
    const snapshot = parseSnapshot(SNAPSHOT);
    expect(snapshot.elements.map((element) => element.eid)).toEqual(["e1", "e2", "e3"]);

    const [link, textbox, button] = snapshot.elements;
    expect(link?.role).toBe("link");
    expect(link?.attrs.href).toBe("https://www.iana.org/domains/example");
    expect(link?.name).toBe("More information...");

    expect(textbox?.role).toBe("textbox");
    expect(textbox?.attrs.placeholder).toBe("Search");
    expect(textbox?.value).toBe("cats");
    expect(textbox?.name).toBe("Search the site");

    expect(button?.role).toBe("button");
    expect(button?.attrs).toEqual({});
    expect(button?.name).toBe("");
  });

  test("keeps a `>` that appears inside an attribute value", () => {
    const snapshot = parseSnapshot(
      '[e4] <link href="https://a.test/?a=1>2"> Compare',
    );
    const [element] = snapshot.elements;
    expect(element?.attrs.href).toBe("https://a.test/?a=1>2");
    expect(element?.name).toBe("Compare");
  });

  test("handles a page with no interactive elements", () => {
    const snapshot = parseSnapshot(`<external_content source="web" origin="https://b.test/">
URL: https://b.test/
Title: Quiet

(no interactive elements found)
</external_content>`);
    expect(snapshot.elements).toEqual([]);
    expect(snapshot.title).toBe("Quiet");
  });

  test("treats the `(none)` title placeholder as no title", () => {
    const snapshot = parseSnapshot("URL: https://c.test/\nTitle: (none)\n");
    expect(snapshot.title).toBe("");
  });

  test("falls back to the fence origin when the URL header is missing", () => {
    const snapshot = parseSnapshot(
      '<external_content source="web" origin="https://d.test/page">Title: D</external_content>',
    );
    expect(snapshot.url).toBe("https://d.test/page");
  });

  test("falls back to the caller's URL when neither is present", () => {
    expect(parseSnapshot("Title: E", "https://e.test/").url).toBe("https://e.test/");
  });
});

describe("parseNavigate", () => {
  test("reads the title and the settled URL from the fence origin", () => {
    const result = parseNavigate(
      '<external_content source="web" origin="https://f.test/final">\nTitle: Landed\n</external_content>',
    );
    expect(result.title).toBe("Landed");
    expect(result.url).toBe("https://f.test/final");
  });
});

describe("parseExtract", () => {
  test("returns the unfenced page text", () => {
    const result = parseExtract(
      '<external_content source="web" origin="https://g.test/">\nLine one\nLine two\n</external_content>',
    );
    expect(result.text).toBe("Line one\nLine two");
    expect(result.url).toBe("https://g.test/");
  });
});

describe("parseStatus", () => {
  test("parses the backend readiness document", () => {
    const status = parseStatus(
      JSON.stringify({
        requestedMode: "auto",
        recommendedMode: "extension",
        modes: [
          {
            mode: "extension",
            available: true,
            autoCandidate: true,
            summary: "Paired",
            userActions: [],
          },
          { mode: "local", available: false, summary: "Not installed" },
        ],
      }),
    );
    expect(status.recommendedMode).toBe("extension");
    expect(status.modes).toHaveLength(2);
    expect(status.modes[0]?.available).toBe(true);
    expect(status.modes[1]?.autoCandidate).toBe(false);
    expect(status.modes[1]?.userActions).toEqual([]);
  });

  test("degrades to no known backends rather than throwing", () => {
    expect(parseStatus("not json").modes).toEqual([]);
    expect(parseStatus("[1,2,3]").modes).toEqual([]);
  });

  test("drops malformed mode entries", () => {
    const status = parseStatus(JSON.stringify({ modes: [null, 7, { available: true }] }));
    expect(status.modes).toEqual([]);
  });
});
