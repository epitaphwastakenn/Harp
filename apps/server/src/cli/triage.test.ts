// @effect-diagnostics nodeBuiltinImport:off - CLI integration spawns a fake agent from PATH.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import { vi } from "vite-plus/test";

import packageJson from "../../package.json" with { type: "json" };
import { cli } from "../binCli.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import { describeServerProcess } from "./triage.ts";
import { buildTriageLaunchPrompt } from "./triagePrompt.ts";

it.effect("reports the version the running server recorded, not the CLI's", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const statePath = path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "t3-triage-" }),
      "server-runtime.json",
    );
    const state = yield* makePersistedServerRuntimeState({
      config: { host: undefined, devUrl: undefined },
      port: 3773,
    });
    yield* persistServerRuntimeState({ path: statePath, state });

    assert.equal(
      yield* describeServerProcess(statePath),
      `running (pid ${String(process.pid)}, http://127.0.0.1:3773, version ${packageJson.version})`,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

const FAILING_AGENT_POSIX = `#!/bin/sh
echo "Error: There is not enough space on the disk. (os error 112)" >&2
exit 1
`;
const FAILING_AGENT_WINDOWS = `@echo Error: There is not enough space on the disk. (os error 112) 1>&2
@exit /b 1
`;

it.live("a failed agent launch points at the prompt it could not run", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-triage-cli-" });
    const binDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-triage-bin-" });
    const codexHome = NodePath.join(baseDir, "codex-home");
    NodeFS.writeFileSync(NodePath.join(binDir, "codex"), FAILING_AGENT_POSIX, { mode: 0o755 });
    NodeFS.writeFileSync(NodePath.join(binDir, "codex.cmd"), FAILING_AGENT_WINDOWS);
    yield* Effect.acquireRelease(
      // PATH holds only the fake agent, so a broken fixture can never fall through to a real codex.
      Effect.sync(() => {
        vi.stubEnv("PATH", binDir);
        vi.stubEnv("CODEX_HOME", codexHome);
      }),
      () => Effect.sync(() => vi.unstubAllEnvs()),
    );
    const previousExitCode = process.exitCode;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        process.exitCode = previousExitCode;
      }),
    );

    yield* Command.runWith(cli, { version: "0.0.0" })([
      "triage",
      "--agent",
      "codex",
      "--base-dir",
      baseDir,
    ]);
    const output = (yield* TestConsole.logLines).join("\n");

    assert.equal(process.exitCode, 1);
    const promptFilePath = NodeFS.readdirSync(baseDir, { recursive: true, encoding: "utf8" })
      .filter((entry) => NodePath.basename(entry) === "prompt.md")
      .map((entry) => NodePath.join(baseDir, entry))[0];
    assert.isDefined(promptFilePath);
    assert.include(output, promptFilePath);
    assert.include(output, buildTriageLaunchPrompt(promptFilePath));
    assert.include(output, NodePath.join(NodePath.dirname(promptFilePath), "context.md"));
    assert.include(output, `Codex keeps its state in ${codexHome}.`);
    assert.include(output, "set CODEX_HOME to a folder on another drive");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer, TestConsole.layer),
    ),
  ),
);
