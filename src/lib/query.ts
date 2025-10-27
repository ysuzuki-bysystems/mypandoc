import * as z from "zod";

declare global {
  interface Uint8ArrayConstructor {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/fromBase64
    fromBase64: (
      string: string,
      options?: {
        alphabet?: "base64" | "base64url" | undefined;
        lastChunkHandling?:
          | "loose"
          | "strict"
          | "stop-before-partial"
          | undefined;
      },
    ) => Uint8Array<ArrayBuffer>;
  }

  interface Uint8Array {
    toBase64: (options?: {
      alphabet?: "base64" | "base64url" | undefined;
      omitPadding?: boolean | undefined;
    }) => string;
  }
}

export type Query = {
  url: string;
  args: string[];
};

const zQuery = z.object({
  url: z.string(),
  args: z.string().array(),
});

async function encodeV1(query: Query): Promise<string> {
  const json = JSON.stringify(query);
  const source = new Blob([json]).stream();
  const deflate = source.pipeThrough(new CompressionStream("deflate"));

  const data: Uint8Array<ArrayBuffer>[] = [];
  await deflate.pipeTo(
    new WritableStream({
      write: (chunk) => {
        data.push(chunk);
      },
    }),
  );

  const b64 = new Uint8Array(await new Blob(data).arrayBuffer()).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
  return b64;
}

export async function encode(query: Query): Promise<string> {
  return `v1:${await encodeV1(query)}`;
}

async function decodeV1(text: string): Promise<Query> {
  const b64 = Uint8Array.fromBase64(text, { alphabet: "base64url" });
  const source = new Blob([b64]).stream();
  const deflate = source.pipeThrough(new DecompressionStream("deflate"));

  const data: Uint8Array<ArrayBuffer>[] = [];
  await deflate.pipeTo(
    new WritableStream({
      write: (chunk) => {
        data.push(chunk);
      },
    }),
  );

  const json = await new Blob(data).text();
  const query = JSON.parse(json);
  return zQuery.parse(query);
}

export async function decode(text: string): Promise<Query> {
  const [v, data] = text.split(":", 2);
  if (typeof v !== "string" || typeof data !== "string") {
    throw new Error("Unexpected format.");
  }

  switch (v) {
    case "v1":
      return await decodeV1(data);

    default:
      throw new Error(`Unexpected version: ${v}`);
  }
}

if (import.meta.vitest) {
  const { describe, it, assert } = import.meta.vitest;

  describe("encode | decode", () => {
    it("success", async () => {
      const q: Query = {
        url: "http://example.com/",
        args: ["-fmarkdown", "-thtml"],
      };
      const encoded = await encode(q);
      const q2 = await decode(encoded);

      assert.deepEqual(q, q2);
    });
  });
}
