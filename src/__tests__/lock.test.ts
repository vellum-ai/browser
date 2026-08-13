import { describe, expect, test } from "bun:test";

import { exclusive } from "../lock.js";

describe("exclusive", () => {
  test("runs callers one at a time, in the order they arrived", async () => {
    const seen: number[] = [];
    let releaseFirst: () => void = () => {
      // Replaced when the first call starts.
    };

    const first = exclusive(async () => {
      seen.push(1);
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      seen.push(2);
      return "first";
    });

    const second = exclusive(async () => {
      seen.push(3);
      return "second";
    });

    await Promise.resolve();
    expect(seen).toEqual([1]);

    releaseFirst();
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(seen).toEqual([1, 2, 3]);
  });

  test("a failure still releases the gate", async () => {
    await exclusive(async () => {
      throw new Error("boom");
    }).catch((err: unknown) => {
      expect(err).toBeInstanceOf(Error);
    });

    expect(await exclusive(async () => "ok")).toBe("ok");
  });
});
