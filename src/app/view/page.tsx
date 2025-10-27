"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { decode as decodeQuery } from "@/lib/query";
import type { Pandoc } from "@/lib/pandoc";
import { newPandoc } from "@/lib/pandoc";

let pandoc: Promise<Pandoc> | undefined;

async function render(href: URL, args: string[]): Promise<Blob> {
  const response = await fetch(href);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.body === null) {
    throw new Error();
  }

  const fn = await (pandoc ??= newPandoc({}));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  await fn({
    args,
    stdin: response.body,
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
  return blob;
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
  const [contentUrl, setContentUrl] = useState<URL | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    (async (signal) => {
      if (hash === null) {
        setContentUrl(null);
        return;
      }

      const query = await decodeQuery(hash);
      const content = await render(new URL(query.url), query.args);
      if (signal.aborted) {
        return;
      }

      const contentUrl = URL.createObjectURL(content);
      signal.addEventListener("abort", () => URL.revokeObjectURL(contentUrl));
      setContentUrl(new URL(contentUrl));
    })(abort.signal);
    return () => abort.abort();
  }, [hash]);

  useEffect(() => {
    if (contentUrl === null) {
      return;
    }

    ref.current?.focus();
  }, [contentUrl]);

  if (contentUrl === null) {
    return;
  }

  return (
    <>
      <iframe ref={ref} src={contentUrl.href} className="w-screen h-screen" />
    </>
  );
}
