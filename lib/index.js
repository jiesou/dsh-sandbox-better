import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
// src/locales.ts
/** Locale-owned approval text; the audit reason stays English and verbatim. */
/** English approval message. */
const en = { permissionRequest: (directory) => `Allow writes under ${directory} for this session?` };
/** Chinese approval message. */
const zh = { permissionRequest: (directory) => `允许本会话写入 ${directory}？` };
/** Japanese approval message. */
const ja = { permissionRequest: (directory) => `このセッションで ${directory} への書き込みを許可しますか？` };
/** Spanish approval message. */
const es = { permissionRequest: (directory) => `¿Permitir escrituras en ${directory} durante esta sesión?` };
/** French approval message. */
const fr = { permissionRequest: (directory) => `Autoriser les écritures dans ${directory} pour cette session ?` };
/** German approval message. */
const de = { permissionRequest: (directory) => `Schreibzugriff auf ${directory} für diese Sitzung erlauben?` };
/** Russian approval message. */
const ru = { permissionRequest: (directory) => `Разрешить запись в ${directory} на время этого сеанса?` };
/** Portuguese approval message. */
const pt = { permissionRequest: (directory) => `Permitir gravações em ${directory} nesta sessão?` };
/**
* Build translations for the Client's localized-text resolver.
* @param directory - the physical directory the request would grant.
* @returns approval text per locale.
*/
function permissionRequestDisplayReason(directory) {
	return {
		en: en.permissionRequest(directory),
		zh: zh.permissionRequest(directory),
		ja: ja.permissionRequest(directory),
		es: es.permissionRequest(directory),
		fr: fr.permissionRequest(directory),
		de: de.permissionRequest(directory),
		ru: ru.permissionRequest(directory),
		pt: pt.permissionRequest(directory)
	};
}
// src/grants.ts
const TOOL_NAME = "request_write_access";
/** One live Session's grants, keyed by the physical directory they cover. */
const registry = /* @__PURE__ */ new WeakMap();
function reasonOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Expand `~`, anchor relative paths at the session workspace, and resolve symlinks. */
function resolveGrantDir(session, input) {
	const raw = input.trim();
	if (raw === "") throw new Error(`${TOOL_NAME}: a directory is required`);
	const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	const base = session.header.cwd ?? process.cwd();
	const absolute = isAbsolute(expanded) ? expanded : resolve(base, expanded);
	let stats;
	try {
		stats = statSync(absolute);
	} catch {
		throw new Error(`${TOOL_NAME}: "${raw}" does not exist`);
	}
	if (!stats.isDirectory()) throw new Error(`${TOOL_NAME}: "${raw}" is not a directory`);
	return realpathSync(absolute);
}
/** Register one physical directory for a session's future workspace-write calls; idempotent. */
function grantDirectory(host, session, input) {
	const dir = resolveGrantDir(session, input);
	const grants = registry.get(session) ?? /* @__PURE__ */ new Map();
	if (!grants.has(dir)) {
		grants.set(dir, host.sandboxPolicy.registerWritableRoot(session, dir));
		registry.set(session, grants);
	}
	return dir;
}
function toolDefinition(host) {
	return {
		name: TOOL_NAME,
		description: "Ask the user to make one directory writable for this session. Under workspace-write only the workspace is writable and everything else is read-only; call this after a write there was denied, then retry.",
		parameters: { path: {
			type: "string",
			description: "Directory, absolute or relative to the workspace; `~` expands."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				required: ["path"],
				properties: { path: { type: "string" } }
			},
			render: (_args, value) => [{
				type: "text",
				text: `${value.path} is writable for this session.`
			}]
		},
		async execute(args, exec) {
			const session = exec.agent?.session;
			if (session === void 0) throw new Error(`${TOOL_NAME}: this call has no session to grant to`);
			const path = args.path?.trim() ?? "";
			if (path === "") throw new Error(`${TOOL_NAME}: path is required`);
			const dir = resolveGrantDir(session, path);
			const approval = host.approval;
			if (approval === void 0) throw new Error(`${TOOL_NAME}: this composition has no approval service`);
			let outcome;
			try {
				outcome = await approval.request({
					agent: exec.agent,
					toolName: TOOL_NAME,
					...exec.callId === void 0 ? {} : { callId: exec.callId },
					reason: `Write access to ${dir} for this session.`,
					displayReason: permissionRequestDisplayReason(dir),
					...exec.signal === void 0 ? {} : { signal: exec.signal }
				});
			} catch (error) {
				throw new Error(`${TOOL_NAME}: the approval request failed: ${reasonOf(error)}`);
			}
			if (outcome !== "allowed-once") throw new Error(`${TOOL_NAME}: the user did not allow writes under ${dir} (${outcome})`);
			grantDirectory(host, session, path);
			return { path: dir };
		}
	};
}
/** Register the request tool and its one-line prompt guidance. */
function applyGrants(host) {
	const register = () => {
		const tools = host.tools;
		if (tools === void 0) return () => {};
		const dispose = tools.register(toolDefinition(host), { when: ({ agent }) => host.modeOf?.(agent) !== "danger-full-access" });
		const prompt = host.systemPrompt;
		if (prompt !== void 0) prompt.section({
			name: `tool:${TOOL_NAME}`,
			order: prompt.getSectionOrder("TOOL_BASH"),
			text: `A path outside the workspace is read-only: request it with \`${TOOL_NAME}\`, not sandbox_permissions.`
		});
		return dispose;
	};
	if (host.effect === void 0) {
		register();
		return;
	}
	host.effect(register, "sandbox-better permission requests");
}
// src/policy-text.ts
/**
* Keep the model's runtime context free of the deployment's directory list.
*
* `dsh-sandbox-policy` writes `Additional writable directories: [...]` into the
* per-step policy line. That list is machine configuration, not a decision the
* model has to make, and it repeats every step. The policy line itself
* (mode + workspace) stays.
*
* The removal is anchored, not a bare `indexOf`:
* - the text must be the workspace-write policy line this plugin knows;
* - the marker must directly follow the JSON workspace string (`".`), so a
*   directory whose name contains the marker cannot hijack it;
* - the clause must start a JSON array, must end in the known tail sentence at
*   the very end of the line, and must stay under a size bound;
* - anything unexpected leaves the text untouched, so a rewording upstream
*   keeps the list rather than cutting the wrong bytes.
*/
const PREFIX = "Current DSH file policy: workspace-write. ";
const MARKER = " Additional writable directories: ";
const TAIL = " Some platform temporary areas may also be writable.";
const MAX_CLAUSE_BYTES = 8192;
/**
* Remove the additional-directories clause from one policy line.
* @param text - the rendered `sandbox:policy` context.
* @returns the line without the clause; unchanged when any anchor fails.
*/
function stripAdditionalRoots(text) {
	if (!text.startsWith(PREFIX) || !text.endsWith(TAIL)) return text;
	let start = text.indexOf(MARKER);
	while (start >= 0) {
		if (text.slice(0, start).endsWith("\".") && text[start + 34] === "[") break;
		start = text.indexOf(MARKER, start + 1);
	}
	if (start < 0) return text;
	const tailStart = text.lastIndexOf(TAIL);
	if (tailStart <= start || tailStart - start > MAX_CLAUSE_BYTES) return text;
	return `${text.slice(0, start)}${text.slice(tailStart)}`;
}
// src/tolerate.ts
/**
* Tolerant reading of the escalation arguments models get wrong most often.
*
* The stock tools validate `sandbox_permissions` / `justification` strictly and
* throw before anything runs: a stray justification, a missing one, a target
* that is not strictly wider. None of those errors protect anything — the call
* would simply have run under the current mode — so this plugin rewrites the
* two permission fields and lets the call proceed.
*/
/** Tools whose schema carries the escalation pair. */
const ESCALATION_TOOLS = /* @__PURE__ */ new Set([
	"bash",
	"pwsh",
	"write",
	"edit"
]);
/** The closed sandbox-mode vocabulary; anything else stays the model's error. */
const KNOWN_MODES = /* @__PURE__ */ new Set([
	"read-only",
	"workspace-write",
	"danger-full-access"
]);
/** Strictly wider targets per effective mode, mirroring the harness table. */
const WIDER_MODES = {
	"read-only": ["workspace-write", "danger-full-access"],
	"workspace-write": ["danger-full-access"]
};
/** Stand-in reason for a widening request that carried none. */
const DEFAULT_JUSTIFICATION = "Agent did not attach a justification.";
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Rewrite the permission fields of one tool call.
* @param name - tool name.
* @param raw - parsed arguments, untouched.
* @param mode - the call's effective sandbox mode.
* @returns replacement arguments, or undefined when nothing needs rewriting.
*/
function normalizePermissionArgs(name, raw, mode) {
	if (!ESCALATION_TOOLS.has(name) || !isRecord(raw)) return void 0;
	const hasMode = typeof raw.sandbox_permissions === "string" && raw.sandbox_permissions.length > 0;
	const hasJustification = typeof raw.justification === "string" && raw.justification.trim().length > 0;
	if (!hasMode) {
		if (raw.justification === void 0) return void 0;
		const { justification: _drop, ...rest } = raw;
		return rest;
	}
	const target = raw.sandbox_permissions;
	if (!KNOWN_MODES.has(target)) return void 0;
	if (!(WIDER_MODES[mode] ?? []).includes(target)) {
		const { sandbox_permissions: _mode, justification: _reason, ...rest } = raw;
		return rest;
	}
	if (hasJustification) return void 0;
	return {
		...raw,
		justification: DEFAULT_JUSTIFICATION
	};
}
// src/index.ts
const name = "dsh-sandbox-better";
const inject = ["tools", "sandboxPolicy"];
function resolveMode(host, session) {
	try {
		if (session === void 0) return "workspace-write";
		return host.get("sandboxPolicy").resolve({ session }).mode;
	} catch {
		return "workspace-write";
	}
}
/**
* Mount the request tool, its approval card guidance and the tolerant reading
* of the escalation arguments. Nothing here belongs to one sandbox backend: the
* grant is a `sandbox-policy` registration, so it lands on every provider.
*/
function apply(ctx) {
	const host = ctx;
	if (host.get === void 0) return;
	applyGrants({
		get sandboxPolicy() {
			return host.get("sandboxPolicy");
		},
		get approval() {
			return host.get("approval");
		},
		get tools() {
			return host.get("tools");
		},
		get systemPrompt() {
			return host.get("systemPrompt");
		},
		modeOf: (agent) => resolveMode(host, agent.session),
		effect: host.effect === void 0 ? void 0 : host.effect.bind(host)
	});
	host.on?.("system-prompt/assemble", (async (_assembly, _context, next) => {
		const result = await next();
		if (!Array.isArray(result?.contexts)) return result;
		for (const context of result.contexts) if (context.name === "sandbox:policy") context.text = stripAdditionalRoots(context.text);
		return result;
	}));
	host.on?.("tools/pre-execute", ((exec, next) => {
		try {
			const normalized = normalizePermissionArgs(exec.name, exec.arguments, resolveMode(host, exec.agent?.session));
			if (normalized !== void 0) exec.arguments = normalized;
		} catch {}
		return next();
	}));
}
var src_default = {
	name,
	apply,
	inject
};
export { apply, src_default as default, inject, name };
