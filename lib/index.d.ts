import { Context } from "@deepseek-ai/cordis";
interface PluginCtx {
  get?: (name: string) => unknown;
  effect?: (callback: () => () => void, label?: string) => unknown;
  on?: (event: string, listener: (...args: never[]) => unknown) => void;
}
declare const name = "dsh-sandbox-better";
declare const inject: string[];
/**
 * Mount the request tool, its approval card guidance and the tolerant reading
 * of the escalation arguments. Nothing here belongs to one sandbox backend: the
 * grant is a `sandbox-policy` registration, so it lands on every provider.
 */
declare function apply(ctx: Context | PluginCtx): void;
declare const _default: {
  name: string;
  apply: typeof apply;
  inject: string[];
};
export { apply, _default as default, inject, name };