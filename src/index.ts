import type { Context } from '@deepseek-ai/cordis'
import { applyGrants } from './grants'
import type { GrantHost } from './grants'
import { stripAdditionalRoots } from './policy-text'
import { normalizePermissionArgs } from './tolerate'

interface SandboxPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
}

interface ToolExecutionLike {
  readonly name: string
  readonly arguments: unknown
  readonly agent?: { readonly session: unknown }
}

interface PluginCtx {
  get?: (name: string) => unknown
  effect?: (callback: () => () => void, label?: string) => unknown
  on?: (event: string, listener: (...args: never[]) => unknown) => void
}

export const name = 'dsh-sandbox-better'
export const inject = ['tools', 'sandboxPolicy']

function resolveMode(host: PluginCtx, session: unknown): string {
  try {
    if (session === undefined) return 'workspace-write'
    const policy = host.get!('sandboxPolicy') as { resolve(request?: { session?: unknown }): SandboxPolicy }
    return policy.resolve({ session }).mode
  } catch {
    return 'workspace-write'
  }
}

/**
 * Mount the request tool, its approval card guidance and the tolerant reading
 * of the escalation arguments. Nothing here belongs to one sandbox backend: the
 * grant is a `sandbox-policy` registration, so it lands on every provider.
 */
export function apply(ctx: Context | PluginCtx): void {
  const host = ctx as unknown as PluginCtx
  if (host.get === undefined) return
  const services: GrantHost = {
    get sandboxPolicy() {
      return host.get!('sandboxPolicy') as GrantHost['sandboxPolicy']
    },
    get approval() {
      return host.get!('approval') as GrantHost['approval']
    },
    get tools() {
      return host.get!('tools') as GrantHost['tools']
    },
    get systemPrompt() {
      return host.get!('systemPrompt') as GrantHost['systemPrompt']
    },
    modeOf: (agent) => resolveMode(host, agent.session),
    effect: host.effect === undefined ? undefined : host.effect.bind(host),
  }
  applyGrants(services)
  host.on?.('system-prompt/assemble', (async (
    _assembly: unknown,
    _context: unknown,
    next: () => Promise<unknown>,
  ) => {
    const result = await next() as { contexts?: Array<{ name: string; text: string }> } | undefined
    if (!Array.isArray(result?.contexts)) return result
    for (const context of result.contexts) {
      if (context.name === 'sandbox:policy') context.text = stripAdditionalRoots(context.text)
    }
    return result
  }) as (...args: never[]) => unknown)
  host.on?.('tools/pre-execute', ((exec: ToolExecutionLike, next: () => Promise<unknown>) => {
    try {
      const normalized = normalizePermissionArgs(
        exec.name,
        exec.arguments,
        resolveMode(host, exec.agent?.session),
      )
      if (normalized !== undefined) (exec as { arguments: unknown }).arguments = normalized
    } catch {
      // A call that cannot be normalized runs exactly as the model wrote it.
    }
    return next()
  }) as (...args: never[]) => unknown)
}

export default { name, apply, inject }
