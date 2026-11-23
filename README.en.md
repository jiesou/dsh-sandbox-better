# dsh-sandbox-better

The model asks for one writable directory: the `request_write_access` tool, session-scoped grants, its own approval card, and tolerant sandbox arguments.

[简体中文](README.md)

The default `workspace-write` mode lets the agent write only inside the workspace. The only escape hatch used to be `sandbox_permissions`, which widened the whole session to full access just to write into one directory.

This plugin handles **asking and deciding** only; it ships no sandbox backend:

- the model calls `request_write_access`;
- you answer on the card ("Allow for this session" or "Reject");
- an approval goes through the official `SandboxPolicyService.registerWritableRoot`, so the directory becomes writable for this session's bash and file tools;
- the grant dies with the session, the sandbox mode never changes, and nothing is written to disk.

Because the grant is just a `sandbox-policy` registration, it is backend-agnostic: bwrap, Landlock and Seatbelt all honour it. The Linux Landlock backend lives in [dsh-sandbox-landlock](https://github.com/jiesou/dsh-sandbox-landlock).

## Install

```sh
dsh plugin --profile web add github:jiesou/dsh-sandbox-better
# or from a local checkout
dsh plugin --profile web add /path/to/dsh-sandbox-better
```

Restart the web surface afterwards — both the bundle layer and the client manifest are read at boot. Requires DSH `>=0.2.2-rc.2` (the release that exposes `registerWritableRoot`).

## Tool and card

```
tool: request_write_access { path: "~/Documents/dev/other-repo" }

┌ Waiting for your approval
│ Allow writes under /var/home/chen/Documents/dev/other-repo?
│                                    [Reject] [Allow for this session]
```

- One parameter, `path`: absolute, or relative to the workspace; `~` expands; the directory must exist.
- The card is rendered by this plugin. The path is the headline; the scope lives on the button. It works because `conversation.composer` is a chain slot — the stock approval card's factory slot refuses a second registration and its button text is hardcoded.
- Every other approval (bash/write escalation) still uses the stock card; this plugin claims only its own requests.
- Under `danger-full-access` the tool is not registered into the step at all (`when` condition), so the model never sees a request that no longer means anything.

## The directory list stays out of the prompt

`dsh-sandbox-policy` writes the deployment's `additionalWritableRoots` into every step's runtime context (`Additional writable directories: [...]`). That is machine configuration, not a decision the model makes, and it repeats every step. This plugin removes the clause in `system-prompt/assemble`: the mode and workspace stay, the list does not appear.

## Tolerant sandbox arguments

Models frequently lose track of their mode and write the permission fields wrong. Before dispatch the plugin rewrites only `sandbox_permissions` / `justification`, for `bash` / `pwsh` / `write` / `edit`:

| Model sent | Handled as |
| --- | --- |
| `justification` without `sandbox_permissions` | dropped |
| widening target without a reason / blank reason | `Agent did not attach a justification.` |
| a known target that is same or narrower | both fields dropped; the call runs under the current mode |
| a value outside the mode vocabulary (`full`, `workspace_write`, …) | left alone, the harness reports `invalid arguments` |

`command`, `path` and `content` are never touched, so the call card and the audit log still show what the model asked for.

## Verify

1. Ask the model to write outside the workspace; it reports the denial.
2. It calls `request_write_access`; approve it.
3. The same write succeeds.
4. End the session and the write is denied again.

## Limitations

- Grants are runtime-only: they are not written to the session log, must be re-requested after resume or fork, and processes already running keep their permissions.
- No revoke surface: end the session or switch the permission preset.
- No sandbox backend and no deployment-wide directories — those belong to `sandbox-policy.additionalWritableRoots`.

## Development

```sh
pnpm install
pnpm run check   # typecheck + build + test
```

`lib/` and `client.js` are distribution artifacts and are committed so `github:` installs need no build step.

## License

[MIT](LICENSE)
