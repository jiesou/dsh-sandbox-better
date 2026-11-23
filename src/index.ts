import type { Context } from '@deepseek-ai/cordis'
import { applyGrants } from './grants'
import type { GrantHost } from './grants'
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
  on?: (event: string, listener: (exec: ToolExecutionLike, next: () => Promise<unknown>) => Promise<unknown>) => void
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
  host.on?.('tools/pre-execute', (exec, next) => {
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
  })
}

export default { name, apply, inject }
