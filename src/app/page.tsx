"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { encode as encodeQuery } from "@/lib/query";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

const argsItems = {
  "md-html5": ["-fmarkdown", "-thtml5", "-s"],
  "md-revealjs": [
    "-fmarkdown",
    "-trevealjs",
    "-s",
    "-Vrevealjs-url=https://unpkg.com/reveal.js@^4",
    "--slide-level=3",
  ],
} satisfies Record<string, string[]>;

function isArgsItemsKey(val: string): val is keyof typeof argsItems {
  return val in argsItems;
}

function renderArgs(key: keyof typeof argsItems | ""): string {
  if (key === "") {
    return "";
  }

  return ["pandoc", ...argsItems[key]].join(" ");
}

export default function Page(): React.ReactNode {
  const router = useRouter();
  const [href, setHref] = useState("");
  const [args, setArgs] = useState<keyof typeof argsItems | "">("");

  const handleArgsChanged = useCallback((val: string) => {
    if (!isArgsItemsKey(val)) {
      return;
    }

    setArgs(val);
  }, []);

  const handleSubmit = useCallback<React.FormEventHandler<HTMLFormElement>>(
    (event) => {
      event.preventDefault();

      (async () => {
        if (args === "") {
          return;
        }

        const query = await encodeQuery({
          url: href,
          args: argsItems[args],
        });
        router.push(`/view/#${query}`);
      })();
    },
    [router, href, args],
  );

  const urlId = useId();
  const argsId = useId();
  const mainFormId = useId();

  return (
    <main className="w-screen">
      <Card className="w-full max-w-sm mx-auto my-8">
        <CardHeader>
          <CardTitle className="text-center text-4xl font-extrabold tracking-tight text-balance">
            mypandoc
          </CardTitle>
        </CardHeader>

        <CardContent>
          <form id={mainFormId} onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              <Field>
                <FieldLabel htmlFor={urlId}>URL</FieldLabel>
                <Input
                  id={urlId}
                  required
                  placeholder="https://gist.github.com/:user/:id or something"
                  value={href}
                  onChange={(event) => setHref(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={argsId}>Args</FieldLabel>
                <Select required value={args} onValueChange={handleArgsChanged}>
                  <SelectTrigger id={argsId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(argsItems).map(([key]) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <code className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold empty:hidden">
                  {renderArgs(args)}
                </code>
              </Field>
            </div>
          </form>
        </CardContent>

        <CardFooter className="flex-col gap-2">
          <Button form={mainFormId} className="w-full">
            Go
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
