import { wasi } from "./wasi";

export type PandocOpts = {
  args?: string[] | undefined;
  stdin?: ReadableStream<Uint8Array> | undefined;
  stdout?: WritableStream<Uint8Array> | undefined;
  stderr?: WritableStream<Uint8Array> | undefined;
};

export type Pandoc = (opts: PandocOpts) => Promise<void>;

export type NewPandocOpts = {
  fetchWasm?: () => Promise<Response>;
};

async function defaultFetchWasm(): Promise<Response> {
  const response = await fetch(
    new URL("wasm-pandoc/pandoc.wasm", import.meta.url),
  );
  if (!response.ok) {
    throw new Error("Failed to fetch pandoc.wasm");
  }
  return response;
}

export async function newPandoc({
  fetchWasm = defaultFetchWasm,
}: NewPandocOpts): Promise<Pandoc> {
  const mod = await WebAssembly.compileStreaming(fetchWasm());

  return async (opts) => {
    const [imports, start] = wasi({
      ...opts,
      args: ["pandoc", "+RTS", "-H64m", "-RTS", ...(opts.args ?? [])],
    });
    const instance = await WebAssembly.instantiate(mod, imports);

    if (!(instance.exports["memory"] instanceof WebAssembly.Memory)) {
      throw new Error();
    }

    await start(instance);
  };
}

if (import.meta.vitest) {
  const fs = await import("node:fs/promises");

  const { it, assert } = import.meta.vitest;

  async function fetchWasm(): Promise<Response> {
    const href = new URL(import.meta.resolve("wasm-pandoc/pandoc.wasm"));
    const buf = await fs.readFile(href);
    return new Response(buf, {
      headers: {
        "content-type": "application/wasm",
      },
    });
  }

  const pandoc = await newPandoc({ fetchWasm });

  it("ok", async () => {
    const stdin = new Blob(["Hello, World!"]).stream();
    const output: Uint8Array<ArrayBuffer>[] = [];
    const stdout = new WritableStream<Uint8Array>({
      write: (chunk) => {
        output.push(new Uint8Array(chunk));
      },
    });
    /*
    const stderr = new WritableStream<Uint8Array>({
      write: (chunk) => console.error(new TextDecoder().decode(chunk)),
    });
    */

    await pandoc({
      args: ["-fmarkdown", "-thtml"],
      stdin,
      stdout,
      //stderr,
    });

    assert.equal(await new Blob(output).text(), "<p>Hello, World!</p>\n");
  });
}
