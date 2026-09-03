import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const TWS_SUPPORTED_CLI_VERSION = "v1.2.14";
export const TWS_SUPPORTED_REPORT_SCHEMA_VERSION = 1;

export const TwsCommandKind = Schema.Literals([
  "version",
  "registry-list",
  "registry-check",
  "status",
  "stack-status",
]);
export type TwsCommandKind = typeof TwsCommandKind.Type;

const TwsCommandOutputStream = Schema.Literals(["stdout", "stderr"]);

export const TwsCommandFailureLine = Schema.Struct({
  message: Schema.String,
  streams: Schema.Array(TwsCommandOutputStream),
});
export type TwsCommandFailureLine = typeof TwsCommandFailureLine.Type;

export class TwsCommandFailedError extends Schema.TaggedErrorClass<TwsCommandFailedError>()(
  "TwsCommandFailedError",
  {
    command: TwsCommandKind,
    exitCode: Schema.NullOr(Schema.Number),
    failures: Schema.Array(TwsCommandFailureLine),
  },
) {
  override get message(): string {
    return `TWS ${this.command} failed with exit status ${this.exitCode ?? "unknown"}`;
  }
}

export class TwsMalformedVersionError extends Schema.TaggedErrorClass<TwsMalformedVersionError>()(
  "TwsMalformedVersionError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class TwsUnsupportedVersionError extends Schema.TaggedErrorClass<TwsUnsupportedVersionError>()(
  "TwsUnsupportedVersionError",
  {
    actualVersion: Schema.String,
    supportedVersion: Schema.String,
  },
) {
  override get message(): string {
    return `Unsupported TWS version ${this.actualVersion}; expected ${this.supportedVersion}`;
  }
}

export class TwsInvalidFeatureError extends Schema.TaggedErrorClass<TwsInvalidFeatureError>()(
  "TwsInvalidFeatureError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const TwsOutputDecodeReason = Schema.Literals([
  "invalid-json",
  "invalid-shape",
  "missing-required-keys",
  "invalid-utf8",
]);
export type TwsOutputDecodeReason = typeof TwsOutputDecodeReason.Type;

export class TwsOutputDecodeError extends Schema.TaggedErrorClass<TwsOutputDecodeError>()(
  "TwsOutputDecodeError",
  {
    command: TwsCommandKind,
    reason: TwsOutputDecodeReason,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Could not decode TWS ${this.command} output: ${this.detail}`;
  }
}

export class TwsUnsupportedSchemaVersionError extends Schema.TaggedErrorClass<TwsUnsupportedSchemaVersionError>()(
  "TwsUnsupportedSchemaVersionError",
  {
    command: Schema.Literals(["status", "stack-status"]),
    actualVersion: Schema.Unknown,
    supportedVersion: Schema.Number,
  },
) {
  override get message(): string {
    return `Unsupported TWS ${this.command} schema version`;
  }
}

export const TwsCliDecodeError = Schema.Union([
  TwsCommandFailedError,
  TwsMalformedVersionError,
  TwsUnsupportedVersionError,
  TwsInvalidFeatureError,
  TwsOutputDecodeError,
  TwsUnsupportedSchemaVersionError,
]);
export type TwsCliDecodeError = typeof TwsCliDecodeError.Type;

type RawObject = Readonly<Record<string, unknown>>;

export interface TwsVersionInfo {
  readonly version: typeof TWS_SUPPORTED_CLI_VERSION;
}

export interface TwsRegistryEntry {
  readonly id: string;
  readonly path: string;
  readonly aliases: ReadonlyArray<string>;
  readonly kind: string;
  readonly gitIdentity: string;
  readonly markerId: string;
  readonly addedAt: string;
  readonly updatedAt: string;
  readonly raw: RawObject;
}

export interface TwsRegistryCheck {
  readonly entry: TwsRegistryEntry;
  readonly status: string;
  readonly raw: RawObject;
}

export interface TwsUnknownEnumObservation {
  readonly path: string;
  readonly raw: string;
  readonly normalized: "unknown";
}

interface TwsDecodedReportBase {
  readonly schemaVersion: 1;
  readonly raw: RawObject;
  readonly unknownEnums: ReadonlyArray<TwsUnknownEnumObservation>;
  readonly decoderDegraded: boolean;
  readonly twsNeedsAttention: boolean;
}

export interface TwsStatusReport extends TwsDecodedReportBase {
  readonly generatedAt: string;
  readonly workspace: RawObject;
  readonly features: ReadonlyArray<unknown>;
  readonly issues: ReadonlyArray<unknown>;
  readonly summary: RawObject;
}

export interface TwsStackStatusReport extends TwsDecodedReportBase {
  readonly workspace: RawObject;
  readonly feature: string;
  readonly entries: ReadonlyArray<unknown>;
  readonly summary: RawObject;
}

const RawObjectSchema = Schema.Record(Schema.String, Schema.Unknown);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeRawObject = Schema.decodeUnknownEffect(RawObjectSchema);

const RegistryEntryWire = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  aliases: Schema.Array(Schema.String),
  kind: Schema.String,
  git_identity: Schema.String,
  marker_id: Schema.String,
  added_at: Schema.String,
  updated_at: Schema.String,
});
const decodeRegistryEntryWire = Schema.decodeUnknownEffect(RegistryEntryWire);

const RegistryCheckWire = Schema.Struct({
  entry: Schema.Unknown,
  status: Schema.String,
});
const decodeRegistryCheckWire = Schema.decodeUnknownEffect(RegistryCheckWire);

const STATUS_REQUIRED_KEYS = [
  "schema_version",
  "generated_at",
  "workspace",
  "features",
  "issues",
  "summary",
] as const;
const STACK_REQUIRED_KEYS = [
  "schema_version",
  "workspace",
  "feature",
  "entries",
  "summary",
] as const;

const KNOWN_RUNTIME_PRESENCE = new Set(["present", "absent", "stale", "unknown"]);
const KNOWN_AGENT_STATE = new Set(["working", "ready", "blocked", "done", "unknown"]);
const KNOWN_ATTENTION_STATUS = new Set(["needs_attention", "active", "idle"]);

function outputDecodeError(
  command: TwsCommandKind,
  reason: TwsOutputDecodeReason,
  detail: string,
): TwsOutputDecodeError {
  return new TwsOutputDecodeError({ command, reason, detail });
}

function decodeJsonValue(
  command: TwsCommandKind,
  output: string,
): Effect.Effect<unknown, TwsOutputDecodeError> {
  return decodeJson(output).pipe(
    Effect.mapError(() => outputDecodeError(command, "invalid-json", "invalid JSON")),
  );
}

function rawObject(
  command: TwsCommandKind,
  value: unknown,
  detail: string,
): Effect.Effect<RawObject, TwsOutputDecodeError> {
  return decodeRawObject(value).pipe(
    Effect.mapError(() => outputDecodeError(command, "invalid-shape", detail)),
  );
}

function missingRequiredKeys(
  raw: RawObject,
  required: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return required.filter((key) => !Object.hasOwn(raw, key));
}

function canonicalErrorLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.replace(/^error:\s*/iu, "").trim();
}

export function twsCommandFailureLines(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): ReadonlyArray<TwsCommandFailureLine> {
  const failures = new Map<
    string,
    { readonly message: string; readonly streams: Set<"stdout" | "stderr"> }
  >();

  for (const [stream, output] of [
    ["stdout", stdout],
    ["stderr", stderr],
  ] as const) {
    for (const line of output.split(/\r?\n/u)) {
      const message = canonicalErrorLine(line);
      if (!message) {
        continue;
      }
      const key = message.toLowerCase();
      const existing = failures.get(key);
      if (existing) {
        existing.streams.add(stream);
      } else {
        failures.set(key, { message, streams: new Set([stream]) });
      }
    }
  }

  if (failures.size === 0) {
    return [
      {
        message: `tws exited with status ${exitCode ?? "unknown"}`,
        streams: [],
      },
    ];
  }

  return [...failures.values()].map((failure) => ({
    message: failure.message,
    streams: [...failure.streams].sort(),
  }));
}

export function decodeTwsVersionOutput(
  output: string,
): Effect.Effect<TwsVersionInfo, TwsMalformedVersionError | TwsUnsupportedVersionError> {
  const match = /^tws version (v\d+\.\d+\.\d+)$/u.exec(output.trim());
  if (!match?.[1]) {
    return Effect.fail(
      new TwsMalformedVersionError({
        detail: "TWS version output did not match 'tws version vX.Y.Z'",
      }),
    );
  }
  if (match[1] !== TWS_SUPPORTED_CLI_VERSION) {
    return Effect.fail(
      new TwsUnsupportedVersionError({
        actualVersion: match[1],
        supportedVersion: TWS_SUPPORTED_CLI_VERSION,
      }),
    );
  }
  return Effect.succeed({ version: TWS_SUPPORTED_CLI_VERSION });
}

function decodeRegistryEntry(
  command: "registry-list" | "registry-check",
  value: unknown,
): Effect.Effect<TwsRegistryEntry, TwsOutputDecodeError> {
  return Effect.all({
    raw: rawObject(command, value, "registry entry must be an object"),
    entry: decodeRegistryEntryWire(value).pipe(
      Effect.mapError(() =>
        outputDecodeError(command, "invalid-shape", "registry entry fields are invalid"),
      ),
    ),
  }).pipe(
    Effect.map(({ raw, entry }) => ({
      id: entry.id,
      path: entry.path,
      aliases: entry.aliases,
      kind: entry.kind,
      gitIdentity: entry.git_identity,
      markerId: entry.marker_id,
      addedAt: entry.added_at,
      updatedAt: entry.updated_at,
      raw,
    })),
  );
}

export function decodeTwsRegistryList(
  output: string,
): Effect.Effect<ReadonlyArray<TwsRegistryEntry>, TwsOutputDecodeError> {
  return decodeJsonValue("registry-list", output).pipe(
    Effect.flatMap((value) =>
      Array.isArray(value)
        ? Effect.forEach(value, (entry) => decodeRegistryEntry("registry-list", entry), {
            concurrency: 1,
          })
        : Effect.fail(
            outputDecodeError("registry-list", "invalid-shape", "registry list must be an array"),
          ),
    ),
  );
}

export function decodeTwsRegistryCheck(
  output: string,
): Effect.Effect<ReadonlyArray<TwsRegistryCheck>, TwsOutputDecodeError> {
  return decodeJsonValue("registry-check", output).pipe(
    Effect.flatMap((value) =>
      Array.isArray(value)
        ? Effect.forEach(
            value,
            (item) =>
              Effect.all({
                raw: rawObject("registry-check", item, "registry check item must be an object"),
                item: decodeRegistryCheckWire(item).pipe(
                  Effect.mapError(() =>
                    outputDecodeError(
                      "registry-check",
                      "invalid-shape",
                      "registry check fields are invalid",
                    ),
                  ),
                ),
              }).pipe(
                Effect.flatMap(({ raw, item: decoded }) =>
                  decodeRegistryEntry("registry-check", decoded.entry).pipe(
                    Effect.map((entry) => ({
                      entry,
                      status: decoded.status,
                      raw,
                    })),
                  ),
                ),
              ),
            { concurrency: 1 },
          )
        : Effect.fail(
            outputDecodeError("registry-check", "invalid-shape", "registry check must be an array"),
          ),
    ),
  );
}

function observeUnknownEnums(
  value: unknown,
  path: ReadonlyArray<string> = [],
): ReadonlyArray<TwsUnknownEnumObservation> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => observeUnknownEnums(entry, [...path, String(index)]));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const raw = value as RawObject;
  const observations: TwsUnknownEnumObservation[] = [];
  const runtimePresence = raw.runtime_presence;
  if (typeof runtimePresence === "string" && !KNOWN_RUNTIME_PRESENCE.has(runtimePresence)) {
    observations.push({
      path: [...path, "runtime_presence"].join("."),
      raw: runtimePresence,
      normalized: "unknown",
    });
  }
  const agentState = raw.agent_state;
  if (typeof agentState === "string" && !KNOWN_AGENT_STATE.has(agentState)) {
    observations.push({
      path: [...path, "agent_state"].join("."),
      raw: agentState,
      normalized: "unknown",
    });
  }
  const attention = raw.attention;
  if (typeof attention === "object" && attention !== null && !Array.isArray(attention)) {
    const attentionStatus = (attention as RawObject).status;
    if (typeof attentionStatus === "string" && !KNOWN_ATTENTION_STATUS.has(attentionStatus)) {
      observations.push({
        path: [...path, "attention", "status"].join("."),
        raw: attentionStatus,
        normalized: "unknown",
      });
    }
  }

  for (const [key, nested] of Object.entries(raw)) {
    observations.push(...observeUnknownEnums(nested, [...path, key]));
  }
  return observations;
}

function hasTwsAttention(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasTwsAttention);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const raw = value as RawObject;
  const attention = raw.attention;
  if (
    typeof attention === "object" &&
    attention !== null &&
    !Array.isArray(attention) &&
    (attention as RawObject).status === "needs_attention"
  ) {
    return true;
  }
  return Object.values(raw).some(hasTwsAttention);
}

function decodeVersionedReport(
  command: "status" | "stack-status",
  output: string,
  requiredKeys: ReadonlyArray<string>,
): Effect.Effect<RawObject, TwsOutputDecodeError | TwsUnsupportedSchemaVersionError> {
  return Effect.gen(function* () {
    const value = yield* decodeJsonValue(command, output);
    const raw = yield* rawObject(command, value, "report must be an object");
    const missing = missingRequiredKeys(raw, requiredKeys);
    if (missing.length > 0) {
      return yield* outputDecodeError(
        command,
        "missing-required-keys",
        `missing required keys: ${missing.join(", ")}`,
      );
    }
    const schemaVersion = raw.schema_version;
    if (
      typeof schemaVersion !== "number" ||
      !Number.isInteger(schemaVersion) ||
      schemaVersion !== TWS_SUPPORTED_REPORT_SCHEMA_VERSION
    ) {
      return yield* new TwsUnsupportedSchemaVersionError({
        command,
        actualVersion: schemaVersion,
        supportedVersion: TWS_SUPPORTED_REPORT_SCHEMA_VERSION,
      });
    }
    return raw;
  });
}

export function decodeTwsStatus(
  output: string,
): Effect.Effect<TwsStatusReport, TwsOutputDecodeError | TwsUnsupportedSchemaVersionError> {
  return decodeVersionedReport("status", output, STATUS_REQUIRED_KEYS).pipe(
    Effect.flatMap((raw) =>
      Effect.all({
        workspace: rawObject("status", raw.workspace, "workspace must be an object"),
        summary: rawObject("status", raw.summary, "summary must be an object"),
      }).pipe(
        Effect.flatMap(({ workspace, summary }) => {
          if (
            typeof raw.generated_at !== "string" ||
            !Array.isArray(raw.features) ||
            !Array.isArray(raw.issues)
          ) {
            return Effect.fail(
              outputDecodeError("status", "invalid-shape", "status report fields are invalid"),
            );
          }
          const unknownEnums = observeUnknownEnums(raw);
          const summaryNeedsAttention =
            typeof summary.needs_attention === "number" && summary.needs_attention > 0;
          return Effect.succeed({
            schemaVersion: 1 as const,
            generatedAt: raw.generated_at,
            workspace,
            features: raw.features,
            issues: raw.issues,
            summary,
            raw,
            unknownEnums,
            decoderDegraded: unknownEnums.length > 0,
            twsNeedsAttention: summaryNeedsAttention || hasTwsAttention(raw),
          });
        }),
      ),
    ),
  );
}

export function decodeTwsStackStatus(
  output: string,
): Effect.Effect<TwsStackStatusReport, TwsOutputDecodeError | TwsUnsupportedSchemaVersionError> {
  return decodeVersionedReport("stack-status", output, STACK_REQUIRED_KEYS).pipe(
    Effect.flatMap((raw) =>
      Effect.all({
        workspace: rawObject("stack-status", raw.workspace, "workspace must be an object"),
        summary: rawObject("stack-status", raw.summary, "summary must be an object"),
      }).pipe(
        Effect.flatMap(({ workspace, summary }) => {
          if (typeof raw.feature !== "string" || !Array.isArray(raw.entries)) {
            return Effect.fail(
              outputDecodeError(
                "stack-status",
                "invalid-shape",
                "stack status report fields are invalid",
              ),
            );
          }
          const unknownEnums = observeUnknownEnums(raw);
          return Effect.succeed({
            schemaVersion: 1 as const,
            workspace,
            feature: raw.feature,
            entries: raw.entries,
            summary,
            raw,
            unknownEnums,
            decoderDegraded: unknownEnums.length > 0,
            twsNeedsAttention: hasTwsAttention(raw),
          });
        }),
      ),
    ),
  );
}
