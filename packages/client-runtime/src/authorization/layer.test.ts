import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  type ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as RpcHttp from "../rpc/http.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "./service.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
};
const DESCRIPTOR = {
  environmentId: ENVIRONMENT_ID,
  label: "Remote environment",
  platform: {
    os: "linux",
    arch: "x64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
};

type RecordedResponse = Response | ((init: RequestInit) => Response | Promise<Response>);

function recordedFetch(responses: ReadonlyArray<RecordedResponse>) {
  const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    return response === undefined
      ? Promise.reject(new Error(`Unexpected fetch call to ${String(input)}`))
      : Promise.resolve(typeof response === "function" ? response(init ?? {}) : response);
  }) satisfies typeof fetch;
  return { calls, fetchFn };
}

const websocketTicket = (ticket: string) =>
  Response.json({
    ticket,
    expiresAt: "2026-06-06T01:00:00.000Z",
  });

const presentationLayer = Layer.succeed(
  ClientCapabilities.ClientPresentation,
  ClientCapabilities.ClientPresentation.of({
    metadata: { label: "Harp Test", deviceType: "mobile", os: "test" },
  }),
);

const makeHarness = (responses: ReadonlyArray<RecordedResponse>) => {
  const fetch = recordedFetch(responses);
  const layer = RemoteEnvironmentAuthorization.layer.pipe(
    Layer.provide(Layer.mergeAll(RpcHttp.layerRemoteHttpClient(fetch.fetchFn), presentationLayer)),
  );
  return { fetch, layer };
};

describe("RemoteEnvironmentAuthorization", () => {
  it.effect("validates a fresh bearer descriptor while issuing fresh websocket tickets", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch([
        Response.json(DESCRIPTOR),
        websocketTicket("first-ticket"),
        Response.json(DESCRIPTOR),
        websocketTicket("second-ticket"),
      ]);
      const layer = RemoteEnvironmentAuthorization.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            RpcHttp.layerRemoteHttpClient(fetch.fetchFn),
            Layer.succeed(
              ClientCapabilities.ClientPresentation,
              ClientCapabilities.ClientPresentation.of({
                metadata: {
                  label: "Harp Test",
                  deviceType: "mobile",
                  os: "test",
                },
              }),
            ),
          ),
        ),
      );

      const [first, second] = yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorize = () =>
          remote.authorizeBearer({
            expectedEnvironmentId: ENVIRONMENT_ID,
            httpBaseUrl: ENDPOINT.httpBaseUrl,
            wsBaseUrl: ENDPOINT.wsBaseUrl,
            bearerToken: "bearer-token",
            connectionMethod: "direct",
          });
        return [yield* authorize(), yield* authorize()] as const;
      }).pipe(Effect.provide(layer));

      expect(first.socketUrl).toContain("wsTicket=first-ticket");
      expect(second.socketUrl).toContain("wsTicket=second-ticket");
      expect(
        fetch.calls.filter(([url]) => String(url).endsWith("/.well-known/t3/environment")),
      ).toHaveLength(2);
      expect(
        fetch.calls.filter(([url]) => String(url).endsWith("/api/auth/websocket-ticket/rpc")),
      ).toHaveLength(2);
    }),
  );

  it.effect("reuses a matching descriptor a check just read, once, while fresh", () =>
    Effect.gen(function* () {
      const descriptor = {
        ...DESCRIPTOR,
        orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      } as ExecutionEnvironmentDescriptor;
      const harness = makeHarness([
        websocketTicket("reused"),
        ...Array.from({ length: 4 }, () => [
          Response.json(descriptor),
          websocketTicket("fresh"),
        ]).flat(),
        websocketTicket("reused over plain HTTP"),
        Response.json(descriptor),
        websocketTicket("fresh"),
      ]);

      yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorizeAt = (httpBaseUrl: string) =>
          remote.authorizeBearer({
            expectedEnvironmentId: ENVIRONMENT_ID,
            httpBaseUrl,
            wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
            bearerToken: "bearer-token",
            connectionMethod: "direct",
          });
        const authorize = authorizeAt(ENDPOINT.httpBaseUrl);
        const remember = (value: Option.Option<ExecutionEnvironmentDescriptor>) =>
          remote.rememberCheckedDescriptor(ENDPOINT.httpBaseUrl, value, true);

        yield* remember(Option.some(descriptor));
        yield* authorize;
        // Used once.
        yield* authorize;
        // Stale.
        yield* remember(Option.some(descriptor));
        yield* TestClock.adjust("6 seconds");
        yield* authorize;
        // A mismatch reads again, so a host back on the right environment is not blocked.
        yield* remember(Option.some({ ...descriptor, environmentId: "other" as never }));
        yield* authorize;
        // A failed check drops an older match.
        yield* remember(Option.some(descriptor));
        yield* remember(Option.none());
        yield* authorize;
        // Plain HTTP is no reason to read again where the address keeps its host.
        yield* remote.rememberCheckedDescriptor(
          "http://127.0.0.1:3773",
          Option.some(descriptor),
          true,
        );
        yield* authorizeAt("http://127.0.0.1:3773");
        // After a network change, a plain LAN address can belong to another machine.
        yield* remote.rememberCheckedDescriptor(
          "http://192.168.1.2:3773",
          Option.some(descriptor),
          false,
        );
        yield* authorizeAt("http://192.168.1.2:3773");
      }).pipe(Effect.provide(harness.layer));

      expect(harness.fetch.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        "/api/auth/websocket-ticket/rpc",
        ...Array.from({ length: 4 }, () => [
          "/.well-known/t3/environment",
          "/api/auth/websocket-ticket/rpc",
        ]).flat(),
        "/api/auth/websocket-ticket/rpc",
        "/.well-known/t3/environment",
        "/api/auth/websocket-ticket/rpc",
      ]);
    }),
  );

  it.effect("gives up on a silent loopback or LAN address sooner than on a remote one", () =>
    Effect.gen(function* () {
      const silent = () => new Promise<Response>(() => {});
      const harness = makeHarness([silent, silent, silent]);

      yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorizeAt = (httpBaseUrl: string, connectionMethod: "direct" | "ssh" = "direct") =>
          remote
            .authorizeBearer({
              expectedEnvironmentId: ENVIRONMENT_ID,
              httpBaseUrl,
              wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
              bearerToken: "bearer-token",
              connectionMethod,
            })
            .pipe(Effect.flip, Effect.forkChild);
        const lan = yield* authorizeAt("http://192.168.1.2:3773");
        const tailnet = yield* authorizeAt("http://100.101.102.103:3773");
        // An SSH forward listens on loopback but reaches a remote host.
        const forwarded = yield* authorizeAt("http://127.0.0.1:4010", "ssh");

        yield* TestClock.adjust("3 seconds");
        expect(lan.pollUnsafe()).toBeDefined();
        expect(tailnet.pollUnsafe()).toBeUndefined();
        expect(forwarded.pollUnsafe()).toBeUndefined();
        expect(yield* Fiber.join(lan)).toMatchObject({
          _tag: "ConnectionTransientError",
          reason: "timeout",
        });

        yield* TestClock.adjust("7 seconds");
        expect(tailnet.pollUnsafe()).toBeDefined();
        expect(forwarded.pollUnsafe()).toBeDefined();
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});
