# dsh-sandbox-better

模型按目录申请写权限：`request_write_access` 工具、本会话授权、自己的审批卡，以及一套对权限参数的宽容处理。

[English](README.en.md)

默认的 `workspace-write` 只允许写 workspace，其它地方只读。以前模型想写别处，唯一的口子是 `sandbox_permissions`——为了写一个目录，把整个会话放宽到全权限。

本插件只做「申请与裁决」，不提供任何沙箱后端：

- 模型调用 `request_write_access`；
- 你在审批卡上点「本会话允许」（或「拒绝」）；
- 批准后走官方 `SandboxPolicyService.registerWritableRoot`，该目录对本会话后续的 bash 与文件工具生效；
- 会话结束即失效，沙箱模式始终不变，不写任何配置文件。

因为授权只是一个 `sandbox-policy` 注册，它和具体后端无关：bwrap、Landlock、Seatbelt 都能用。Linux 上的 Landlock 后端见 [dsh-sandbox-landlock](https://github.com/jiesou/dsh-sandbox-landlock)。

## 安装

```sh
dsh plugin --profile web add github:jiesou/dsh-sandbox-better
# 或本地
dsh plugin --profile web add /path/to/dsh-sandbox-better
```

装完重启 web（bundle 层与 client 清单都在启动时读取）。要求 DSH `>=0.2.2-rc.2`（`registerWritableRoot` 从该版本提供）。

## 工具与审批卡

```
tool: request_write_access { path: "~/Documents/dev/other-repo" }

┌ 等待你的批准
│ 允许写入 /var/home/chen/Documents/dev/other-repo？
│                              [拒绝] [本会话允许]
```

- 只有一个参数 `path`：绝对路径，或相对 workspace，`~` 会展开；目录必须存在。
- 审批卡由本插件渲染。标题写路径，作用域只出现在按钮上。能做到是因为 `conversation.composer` 是 chain slot——官方审批卡的工厂 slot 不允许二次注册，按钮文字也写死。
- 其它工具的审批（bash/write 的提权）仍走官方卡，本插件只认领自己的请求。
- `danger-full-access` 下这个工具整体不注册进该步（`when` 条件），模型不会看到一个已经无意义的入口。

## 模型看不到目录清单

`dsh-sandbox-policy` 会把部署级的 `additionalWritableRoots` 写进每一步的运行时上下文（`Additional writable directories: [...]`）。那是机器配置，不是模型要做的决定，而且每步重复。本插件在 `system-prompt/assemble` 里把这句删掉：模式与 workspace 保留，目录清单不再出现。

## 宽容的权限参数

模型经常搞不清自己处在哪个模式，把提权参数写歪。插件在派发前只改写 `sandbox_permissions` / `justification` 两个字段（`bash` / `pwsh` / `write` / `edit`）：

| 模型传的 | 处理 |
| --- | --- |
| 只有 `justification`，没有 `sandbox_permissions` | 删掉 |
| 升权但没理由 / 理由是空白 | 补 `Agent did not attach a justification.` |
| 词表内、但同级或更窄的目标 | 两个字段都删掉，按当前模式跑 |
| 词表外的值（`full`、`workspace_write`…） | 不碰，交给宿主报 `invalid arguments` |

`command`、`path`、`content` 一律不动，所以调用卡片与审计日志仍是模型原始参数。

## 验证

1. 让模型写工作区外的目录，它会先收到 `权限不够`；
2. 它调用 `request_write_access`，你点「本会话允许」；
3. 同一目录重试写入成功；
4. 结束会话后，同样的写入重新被拒绝。

## 局限

- 授权是运行时的：不写入会话日志，恢复或 fork 会话后需要重新申请；已在运行的进程保持原权限。
- 不提供撤销面：结束会话或切换权限预设即失效。
- 不提供沙箱后端，也不改部署级目录——那些属于 `sandbox-policy.additionalWritableRoots`。

## 开发

```sh
pnpm install
pnpm run check   # typecheck + build + test
```

`lib/` 与 `client.js` 都是分发产物，随仓库提交，供 `github:` 一行安装。

## License

[MIT](LICENSE)
