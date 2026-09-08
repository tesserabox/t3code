import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const [sdkPath, cliPath, workingDirectory, baseDirectory, evidencePath] = process.argv.slice(2);

if (!sdkPath || !cliPath || !workingDirectory || !baseDirectory || !evidencePath) {
  throw new Error(
    "Usage: copilot-probe.mjs <sdk-path> <cli-path> <working-directory> <base-directory> <evidence-path>",
  );
}

const evidence = {
  authenticated: false,
  cleanedUp: false,
  sessionId: null,
  runtimeVersion: null,
  authType: null,
  permissionKinds: [],
  unexpectedPermissionKinds: [],
  approvedCommand: null,
  toolExecutionSucceeded: false,
  toolOutputMarkerObserved: false,
  sdkCreateResponse: null,
  nativeCliResponse: null,
  sdkListedAfterCliResume: false,
  cliTurnPersistedInOriginalSession: false,
  resumedSessionIdMatched: false,
  sdkResumeResponse: null,
  sdkTurnPersistedAfterResume: false,
  clientCleanup: [],
  error: null,
};

const saveEvidence = () =>
  writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

await saveEvidence();

let CopilotClient;
let RuntimeConnection;
let approvedToolCallId = null;

const expectedCommands = new Set([
  'powershell.exe -NoLogo -NoProfile -Command "Write-Output WIN_APPROVAL_OK"',
  'powershell.exe -NoLogo -NoProfile -Command "Write-Output WIN_APPROVAL_RETRY_OK"',
]);
const initialPrompt =
  'Use the command execution tool to run `powershell.exe -NoLogo -NoProfile -Command "Write-Output WIN_APPROVAL_OK"` exactly once, then reply with exactly WIN_NATIVE_SDK_OK.';
const retryPrompt =
  'The validation requires an actual permission request. Run `powershell.exe -NoLogo -NoProfile -Command "Write-Output WIN_APPROVAL_RETRY_OK"` with the command tool now, then reply with exactly WIN_NATIVE_SDK_OK.';
const cliContinuityPrompt =
  "Read the command output marker from the preceding SDK turn. Reply with exactly that marker followed by _CLI_CONTINUITY. Do not use tools.";
const sdkContinuityPrompt =
  "Take the exact preceding assistant response and replace its _CLI_CONTINUITY suffix with _SDK_CONTINUITY. Reply with only the result. Do not use tools.";

const createClient = () =>
  new CopilotClient({
    mode: "copilot-cli",
    workingDirectory,
    baseDirectory,
    connection: RuntimeConnection.forStdio({ path: cliPath }),
    logLevel: "error",
  });

const permissionHandler = async (request) => {
  evidence.permissionKinds.push(request.kind);
  const command = request.kind === "shell" ? request.fullCommandText.trim() : null;
  const commandIsExpected = command !== null && expectedCommands.has(command);
  const safeShellRequest =
    request.kind === "shell" &&
    commandIsExpected &&
    request.requestSandboxBypass !== true &&
    request.hasWriteFileRedirection === false &&
    request.possiblePaths.length === 0 &&
    request.possibleUrls.length === 0;
  if (!safeShellRequest) {
    evidence.unexpectedPermissionKinds.push(request.kind);
    return {
      kind: "reject",
      feedback: "The validation probe permits only its exact read-only output command.",
    };
  }
  evidence.approvedCommand = command;
  approvedToolCallId = request.toolCallId ?? null;
  return { kind: "approve-once" };
};

const eventHandler = (event) => {
  if (event.type !== "tool.execution_complete" || evidence.approvedCommand === null) {
    return;
  }
  if (approvedToolCallId !== null && event.data.toolCallId !== approvedToolCallId) {
    return;
  }
  evidence.toolExecutionSucceeded = event.data.success === true;
  const content = event.data.result?.content ?? "";
  evidence.toolOutputMarkerObserved =
    content.includes("WIN_APPROVAL_OK") || content.includes("WIN_APPROVAL_RETRY_OK");
};

const stopClient = async (client, label) => {
  let errors;
  try {
    errors = await client.stop();
  } catch (error) {
    errors = [error instanceof Error ? error : new Error(String(error))];
  }
  if (errors.length === 0) {
    evidence.clientCleanup.push({ label, graceful: true, forced: false });
    return;
  }
  try {
    await client.forceStop();
    evidence.clientCleanup.push({
      label,
      graceful: false,
      forced: true,
      errors: errors.map((error) => error.message),
    });
  } catch (error) {
    throw new Error(
      `${label} cleanup failed after ${errors.length} graceful-stop error(s): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

let session;
try {
  ({ CopilotClient, RuntimeConnection } = await import(pathToFileURL(sdkPath).href));
  const client = createClient();
  await client.start();
  try {
    const auth = await client.getAuthStatus();
    const status = await client.getStatus();
    evidence.authenticated = auth.isAuthenticated;
    evidence.authType = auth.authType ?? null;
    evidence.runtimeVersion = status.version;
    await saveEvidence();

    if (!auth.isAuthenticated) {
      process.exitCode = 4;
    } else {
      session = await client.createSession({
        workingDirectory,
        streaming: true,
        enableConfigDiscovery: false,
        enableSkills: false,
        onPermissionRequest: permissionHandler,
        onEvent: eventHandler,
      });
      evidence.sessionId = session.sessionId;
      await saveEvidence();

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await session.sendAndWait(
          {
            prompt:
              attempt === 1
                ? initialPrompt
                : retryPrompt,
          },
          180_000,
        );
        evidence.sdkCreateResponse = response?.data?.content ?? null;
        if (
          evidence.permissionKinds.length > 0 &&
          evidence.toolExecutionSucceeded &&
          evidence.toolOutputMarkerObserved &&
          evidence.sdkCreateResponse?.trim() === "WIN_NATIVE_SDK_OK"
        ) {
          break;
        }
      }
      await session.disconnect();
      session = undefined;

      if (evidence.permissionKinds.length === 0) {
        throw new Error("The packaged SDK turn did not request permission.");
      }
      if (evidence.unexpectedPermissionKinds.length > 0) {
        throw new Error("The packaged SDK turn requested an unexpected permission.");
      }
      if (!evidence.toolExecutionSucceeded || !evidence.toolOutputMarkerObserved) {
        throw new Error("The approved command did not complete with the expected output.");
      }
      if (evidence.sdkCreateResponse?.trim() !== "WIN_NATIVE_SDK_OK") {
        throw new Error("The packaged SDK create response was not the exact expected marker.");
      }
    }
  } finally {
    if (session) {
      try {
        await session.disconnect();
      } catch (error) {
        evidence.error ??= {
          name: error instanceof Error ? error.name : "DisconnectError",
          message: error instanceof Error ? error.message : String(error),
        };
        process.exitCode = process.exitCode || 1;
      }
      session = undefined;
    }
    await stopClient(client, "create-client");
  }

  if (process.exitCode !== 4 && evidence.sessionId) {
    const commandOutputMarker = evidence.approvedCommand.includes("WIN_APPROVAL_RETRY_OK")
      ? "WIN_APPROVAL_RETRY_OK"
      : "WIN_APPROVAL_OK";
    const expectedCliResponse = `${commandOutputMarker}_CLI_CONTINUITY`;
    const expectedSdkResponse = `${commandOutputMarker}_SDK_CONTINUITY`;
    const cliResult = await execFileAsync(
      cliPath,
      [
        `--resume=${evidence.sessionId}`,
        "--prompt",
        cliContinuityPrompt,
        "--allow-all-tools",
        "--excluded-tools=*",
        "--silent",
        "--no-color",
        "--no-custom-instructions",
        "--disable-builtin-mcps",
        "--no-auto-update",
      ],
      {
        cwd: workingDirectory,
        env: { ...process.env, NO_COLOR: "1" },
        timeout: 180_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    evidence.nativeCliResponse = cliResult.stdout.trim();
    if (evidence.nativeCliResponse !== expectedCliResponse) {
      throw new Error("The packaged native CLI did not preserve prior-turn continuity.");
    }

    const resumeClient = createClient();
    await resumeClient.start();
    try {
      const listed = await resumeClient.listSessions();
      evidence.sdkListedAfterCliResume = listed.some(
        (candidate) => candidate.sessionId === evidence.sessionId,
      );
      const resumed = await resumeClient.resumeSession(evidence.sessionId, {
        workingDirectory,
        continuePendingWork: false,
        enableConfigDiscovery: false,
        enableSkills: false,
        availableTools: [],
        onPermissionRequest: permissionHandler,
      });
      evidence.resumedSessionIdMatched = resumed.sessionId === evidence.sessionId;
      const eventsAfterCli = await resumed.getEvents();
      evidence.cliTurnPersistedInOriginalSession =
        eventsAfterCli.some(
          (event) => event.type === "user.message" && event.data.content === cliContinuityPrompt,
        ) &&
        eventsAfterCli.some(
          (event) =>
            event.type === "assistant.message" && event.data.content.trim() === expectedCliResponse,
        ) &&
        eventsAfterCli.some(
          (event) =>
            event.type === "assistant.message" &&
            event.data.content.trim() === "WIN_NATIVE_SDK_OK",
        );
      const response = await resumed.sendAndWait(
        {
          prompt: sdkContinuityPrompt,
        },
        180_000,
      );
      evidence.sdkResumeResponse = response?.data?.content ?? null;
      const eventsAfterSdk = await resumed.getEvents();
      evidence.sdkTurnPersistedAfterResume =
        eventsAfterSdk.some(
          (event) => event.type === "user.message" && event.data.content === sdkContinuityPrompt,
        ) &&
        eventsAfterSdk.some(
          (event) =>
            event.type === "assistant.message" && event.data.content.trim() === expectedSdkResponse,
        );
      await resumed.disconnect();
      if (!evidence.sdkListedAfterCliResume) {
        throw new Error("The fresh SDK client did not list the CLI-resumed session.");
      }
      if (!evidence.resumedSessionIdMatched || !evidence.cliTurnPersistedInOriginalSession) {
        throw new Error("The original session history did not contain the native CLI turn.");
      }
      if (
        evidence.sdkResumeResponse?.trim() !== expectedSdkResponse ||
        !evidence.sdkTurnPersistedAfterResume
      ) {
        throw new Error("The packaged SDK did not preserve resumed conversation continuity.");
      }
    } finally {
      await stopClient(resumeClient, "resume-client");
    }
  }
} catch (error) {
  evidence.error = {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = process.exitCode || 1;
} finally {
  if (evidence.sessionId) {
    const cleanupClient = createClient();
    try {
      await cleanupClient.start();
      await cleanupClient.deleteSession(evidence.sessionId);
      const remaining = await cleanupClient.listSessions();
      evidence.cleanedUp = !remaining.some(
        (candidate) => candidate.sessionId === evidence.sessionId,
      );
    } catch (error) {
      evidence.error ??= {
        name: error instanceof Error ? error.name : "CleanupError",
        message: error instanceof Error ? error.message : String(error),
      };
      process.exitCode = process.exitCode || 1;
    } finally {
      try {
        await stopClient(cleanupClient, "cleanup-client");
      } catch (error) {
        evidence.error ??= {
          name: error instanceof Error ? error.name : "CleanupError",
          message: error instanceof Error ? error.message : String(error),
        };
        process.exitCode = process.exitCode || 1;
      }
    }
  }
  await saveEvidence();
}

if (process.exitCode === 4) {
  const current = JSON.parse(await readFile(evidencePath, "utf8"));
  current.error = {
    name: "CopilotAuthenticationRequired",
    message: "Run the packaged copilot.exe login flow, then rerun the harness.",
  };
  await writeFile(evidencePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}
