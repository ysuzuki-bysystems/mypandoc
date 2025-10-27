declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace WebAssembly {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    export function promising(fn: Function): Function;

    export class Suspending extends Function {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      constructor(fn: Function);
    }
  }
}

const CLOCKID_REALTIME = 0;
const CLOCKID_MONOTONIC = 1;

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;

class Exit extends Error {
  #code: number;

  constructor(code: number) {
    super(`Exit: ${code}`);
    this.#code = code;
  }

  get code(): number {
    return this.#code;
  }
}

export type WasiOpts = {
  args: string[];
  stdin?: ReadableStream<Uint8Array>;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
};

export type Start = (instance: WebAssembly.Instance) => Promise<number>;

type MemoryRef = { ref?: WebAssembly.Memory | undefined };

export function wasi(
  opts: WasiOpts,
): [imports: WebAssembly.Imports, start: Start] {
  const todo = (name: string) => () => {
    throw new Error(`Not implemented: ${name}`);
  };

  const memoryRef: MemoryRef = {};
  const memory = (): WebAssembly.Memory => {
    if (typeof memoryRef.ref === "undefined") {
      throw new Error();
    }
    return memoryRef.ref;
  };

  const imports = {
    wasi_snapshot_preview1: {
      environ_sizes_get: (): number => {
        return ERRNO_SUCCESS;
      },

      args_sizes_get: (argcp: number, arglenp: number): number => {
        const argc = opts.args.length;
        const args = new TextEncoder().encode(
          opts.args.map((v) => `${v}\0`).join(""),
        );

        const view = new DataView(memory().buffer);
        view.setUint32(argcp, argc, true);
        view.setUint32(arglenp, args.length, true);
        return ERRNO_SUCCESS;
      },

      args_get: (argvp: number, argbp: number): number => {
        const view = new DataView(memory().buffer);
        const buf = new Uint8Array(view.buffer);
        const encoder = new TextEncoder();

        for (const arg of opts.args) {
          view.setUint32(argvp, argbp, true);
          argvp += Uint32Array.BYTES_PER_ELEMENT;

          const data = encoder.encode(`${arg}\0`);
          buf.set(data, argbp);
          argbp += data.length;
        }

        return ERRNO_SUCCESS;
      },

      clock_time_get: (id: number, _: bigint, offset: number): number => {
        switch (id) {
          case CLOCKID_REALTIME: {
            const view = new DataView(memory().buffer);
            view.setBigUint64(offset, BigInt(Date.now() * 1_000_000), true);
            return ERRNO_SUCCESS;
          }

          case CLOCKID_MONOTONIC: {
            const now = performance.now();
            const s = now | 0;
            const ms = ((now - s) * 1_000) | 0;
            const v = BigInt(s) * 1_000_000_000n + BigInt(ms) * 1_000_000n;

            const view = new DataView(memory().buffer);
            view.setBigUint64(offset, v, true);
            return ERRNO_SUCCESS;
          }

          default:
            throw new Error(`Not implemented: ${id}`);
        }
      },

      fd_prestat_get: (): number => {
        return ERRNO_BADF;
      },

      fd_read: new WebAssembly.Suspending(
        async (
          fd: number,
          iovp: number,
          iovlen: number,
          nreadp: number,
        ): Promise<number> => {
          if (fd !== 0) {
            return ERRNO_BADF;
          }

          if (typeof opts.stdin === "undefined") {
            return ERRNO_BADF;
          }
          const reader = opts.stdin.getReader({ mode: "byob" });
          using stack = new DisposableStack();
          stack.defer(() => reader.releaseLock());
          let buf = new Uint8Array(8 * 1024);

          const view = new DataView(memory().buffer);
          let nread = 0;

          for (let i = 0; i < iovlen; i++) {
            const off = view.getUint32(iovp + i * 8 + 0, true);
            const len = view.getUint32(iovp + i * 8 + 4, true);

            if (len > buf.length) {
              buf = new Uint8Array(buf.length);
            }
            const { done, value } = await reader.read(buf);
            if (typeof value !== "undefined") {
              new Uint8Array(view.buffer).set(value, off);
              nread += value.length;
              buf = new Uint8Array(value.buffer);
            }

            if (done) {
              break;
            }
          }
          view.setUint32(nreadp, nread, true);

          return ERRNO_SUCCESS;
        },
      ),

      fd_close: new WebAssembly.Suspending(
        async (fd: number): Promise<number> => {
          switch (fd) {
            case 0:
              await opts.stdin?.cancel();
              // TODO
              return ERRNO_SUCCESS;

            default:
              return ERRNO_BADF;
          }
        },
      ),

      fd_write: new WebAssembly.Suspending(
        async (
          fd: number,
          iovp: number,
          iovlen: number,
          nwrittenp: number,
        ): Promise<number> => {
          let writer: WritableStreamDefaultWriter;
          switch (fd) {
            case 1:
              if (typeof opts.stdout === "undefined") {
                // NOP
                return ERRNO_SUCCESS;
              }

              writer = opts.stdout.getWriter();
              break;

            case 2:
              if (typeof opts.stderr === "undefined") {
                // NOP
                return ERRNO_SUCCESS;
              }

              writer = opts.stderr.getWriter();
              break;

            default:
              return ERRNO_BADF;
          }
          using stack = new DisposableStack();
          stack.defer(() => writer.releaseLock());

          const view = new DataView(memory().buffer);
          let nwritten = 0;

          for (let i = 0; i < iovlen; i++) {
            const off = view.getUint32(iovp + i * 8 + 0, true);
            const len = view.getUint32(iovp + i * 8 + 4, true);
            const chunk = new Uint8Array(view.buffer, off, len);
            await writer.write(chunk);
            nwritten += chunk.length;
          }
          view.setUint32(nwrittenp, nwritten, true);

          return ERRNO_SUCCESS;
        },
      ),

      proc_exit: (code: number): never => {
        throw new Exit(code);
      },

      environ_get: todo("environ_get"),
      fd_fdstat_get: todo("fd_fdstat_get"),
      fd_fdstat_set_flags: todo("fd_fdstat_set_flags"),
      fd_filestat_get: todo("fd_filestat_get"),
      fd_filestat_set_size: todo("fd_filestat_set_size"),
      fd_prestat_dir_name: todo("fd_prestat_dir_name"),
      fd_readdir: todo("fd_readdir"),
      fd_seek: todo("fd_seek"),
      path_create_directory: todo("path_create_directory"),
      path_filestat_get: todo("path_filestat_get"),
      path_filestat_set_times: todo("path_filestat_set_times"),
      path_open: todo("path_open"),
      path_readlink: todo("path_readlink"),
      path_remove_directory: todo("path_remove_directory"),
      path_symlink: todo("path_symlink"),
      path_unlink_file: todo("path_unlink_file"),
      poll_oneoff: todo("poll_oneoff"),
      random_get: todo("random_get"),
      sock_recv: todo("sock_recv"),
      sock_send: todo("sock_send"),
    },
  };

  async function start(instance: WebAssembly.Instance): Promise<number> {
    if (!(instance.exports["memory"] instanceof WebAssembly.Memory)) {
      throw new Error();
    }

    memoryRef.ref = instance.exports["memory"];

    const _start = instance.exports["_start"];
    if (typeof _start !== "function") {
      throw new Error();
    }

    try {
      await WebAssembly.promising(_start)();
    } catch (e) {
      if (!(e instanceof Exit)) {
        throw e;
      }

      return e.code;
    }

    throw new Error("Unreachable");
  }

  return [imports, start];
}
