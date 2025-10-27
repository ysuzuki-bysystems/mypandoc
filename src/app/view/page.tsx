"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertCircleIcon } from "lucide-react";
import * as z from "zod";

import { decode as decodeQuery } from "@/lib/query";
import type { Pandoc } from "@/lib/pandoc";
import { newPandoc } from "@/lib/pandoc";

import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle } from "@/components/ui/alert";

const zGistResponse = z.object({
  files: z.record(
    z.string(),
    z.object({
      type: z.string(),
      raw_url: z.string(),
      content: z.string(),
      encoding: z.union([z.literal("utf-8"), z.literal("base64")]),
      truncated: z.boolean(),
    }),
  ),
  description: z.string(),
});

async function fetchContentDefault(
  href: URL,
): Promise<[ReadableStream<Uint8Array>, title?: string | undefined]> {
  const response = await fetch(href);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.body === null) {
    throw new Error();
  }
  return [response.body];
}

async function fetchContentGist(
  href: URL,
): Promise<[ReadableStream<Uint8Array>, title?: string | undefined]> {
  if (href.host !== "gist.github.com") {
    throw new Error();
  }

  const [user, id, ...rest] = href.pathname.slice(1).split("/");
  if (
    typeof user === "undefined" ||
    typeof id === "undefined" ||
    rest.length > 0
  ) {
    return await fetchContentDefault(href);
  }

  const response = await fetch(`https://api.github.com/gists/${id}`, {
    headers: {
      "Content-Type": "application/vnd.github.base64+json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body}`);
  }

  const json = await response.json();
  const parsed = zGistResponse.parse(json);

  for (const obj of Object.values(parsed.files)) {
    if (obj.type !== "text/markdown") {
      continue;
    }

    if (obj.truncated) {
      const [stream] = await fetchContentDefault(new URL(obj.raw_url));
      return [stream, parsed.description];
    }

    if (obj.encoding === "base64") {
      const content = new Blob([Uint8Array.fromBase64(obj.content)]);
      return [content.stream(), parsed.description];
    }

    const content = new Blob([obj.content]);
    return [content.stream(), parsed.description];
  }

  return await fetchContentDefault(href);
}

async function fetchContent(
  href: URL,
): Promise<[ReadableStream<Uint8Array>, title?: string | undefined]> {
  if (href.host === "gist.github.com") {
    return await fetchContentGist(href);
  }

  return await fetchContentDefault(href);
}

let pandoc: Promise<Pandoc> | undefined;

async function render(
  href: URL,
  args: string[],
): Promise<[content: Blob, title: string | undefined]> {
  const [stdin, title] = await fetchContent(href);

  const fn = await (pandoc ??= newPandoc({}));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  await fn({
    args: [...args, `-T${title ?? "-"}`],
    stdin,
    stdout: new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(new Uint8Array(chunk));
      },
    }),
    stderr: new WritableStream<Uint8Array>({
      write: (chunk) => {
        console.log(new TextDecoder().decode(chunk));
      },
    }),
  });
  const blob = new Blob(chunks, { type: "text/html" });
  return [blob, title];
}

function useHash(): string | null {
  const subscribe = useCallback((callback: () => void): (() => void) => {
    const abort = new AbortController();
    window.addEventListener("hashchange", () => callback());
    return () => abort.abort();
  }, []);

  const getSnapshot = useCallback((): string | null => {
    const hash = window.location.hash;
    if (hash.length < 2 || !hash.startsWith("#")) {
      return null;
    }

    return hash.slice(1);
  }, []);

  const hash = useSyncExternalStore(subscribe, getSnapshot, () => null);

  return hash;
}

export default function Page(): React.ReactNode {
  const hash = useHash();
  const [err, setErr] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<URL | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    (async (signal) => {
      setErr(null);

      if (hash === null) {
        setContentUrl(null);
        return;
      }

      try {
        const query = await decodeQuery(hash);
        const [content, title] = await render(new URL(query.url), query.args);
        if (signal.aborted) {
          return;
        }

        const contentUrl = URL.createObjectURL(content);
        signal.addEventListener("abort", () => URL.revokeObjectURL(contentUrl));
        if (typeof title === "string") {
          window.document.title = title;
        }
        setContentUrl(new URL(contentUrl));
      } catch (err) {
        console.error(err);
        setErr("Error occurred.");
      }
    })(abort.signal);
    return () => abort.abort();
  }, [hash]);

  useEffect(() => {
    if (contentUrl === null) {
      return;
    }

    ref.current?.focus();
  }, [contentUrl]);

  if (err !== null) {
    return (
      <>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{err}</AlertTitle>
        </Alert>
      </>
    );
  }

  if (contentUrl === null) {
    return (
      <div className="m-2">
        <Spinner className="inline-block size-8" /> Loading...
      </div>
    );
  }

  return (
    <>
      <iframe ref={ref} src={contentUrl.href} className="w-screen h-screen" />
    </>
  );
}
