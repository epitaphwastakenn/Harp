import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { BearerConnectionTarget } from "./model.ts";
import {
  connectionRouteId,
  connectionRouteKind,
  connectionRouteLabel,
  insertRoute,
  isNearbyAddress,
  mergeLearnedRoutes,
  pendingRouteOrder,
  routeKeepsItsHost,
  routesAfterRemoving,
  sendsTokenInClear,
  upsertRoute,
} from "./routes.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function direct(id: string, httpBaseUrl: string): ConnectionRoute {
  return {
    target: new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Desk",
      connectionId: id,
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: ENVIRONMENT_ID,
        label: "Desk",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}

const LAN = direct("lan", "http://192.168.1.10:3773/");
const TAILNET = direct("tailnet", "https://desk.tail1234.ts.net/");
const PUBLIC = direct("public", "https://desk.example.com/");

const ids = (routes: ReadonlyArray<ConnectionRoute> | null) =>
  routes?.map((route) => connectionRouteId(route.target)) ?? null;

const entryOf = (route: ConnectionRoute): ConnectionCatalogEntry => ({
  target: route.target,
  profile: route.profile,
  enabled: true,
});

describe("connection routes", () => {
  it("classifies and labels direct routes by network", () => {
    expect(connectionRouteKind(LAN)).toBe("lan");
    expect(connectionRouteLabel(LAN)).toBe("LAN");
    expect(connectionRouteLabel(direct("mesh", "http://100.96.0.1:3773/"))).toBe("VPN");
    expect(connectionRouteKind(TAILNET)).toBe("tailnet");
    expect(connectionRouteKind(PUBLIC)).toBe("public");
    expect(connectionRouteKind(direct("lo", "http://127.0.0.1:3773/"))).toBe("loopback");
    expect(connectionRouteKind(direct("ts6", "http://[fd7a:115c:a1e0::1]:3773/"))).toBe("tailnet");
    expect(connectionRouteLabel(TAILNET)).toBe("Tailscale");
  });

  it("knows which addresses reach the same machine on every network", () => {
    const tailnetIp = direct("ts-ip", "http://100.101.102.103:3773/");
    const profile = Option.getOrThrow(tailnetIp.profile) as BearerConnectionProfile;
    const marked = {
      target: tailnetIp.target,
      profile: Option.some(new BearerConnectionProfile({ ...profile, network: "tailscale" })),
    };
    expect(routeKeepsItsHost(PUBLIC)).toBe(true);
    expect(routeKeepsItsHost(direct("ts-tls", "https://desk.tail1234.ts.net/"))).toBe(true);
    expect(routeKeepsItsHost(direct("lo", "http://127.0.0.1:3773/"))).toBe(true);
    // With Tailscale down, a plain http tailnet address can reach another host:
    // carrier networks use 100.64.0.0/10 too, and nothing proves who answers.
    expect(routeKeepsItsHost(direct("ts", "http://desk.tail1234.ts.net:3773/"))).toBe(false);
    expect(routeKeepsItsHost(marked)).toBe(false);
    expect(routeKeepsItsHost(tailnetIp)).toBe(false);
    expect(routeKeepsItsHost(LAN)).toBe(false);
    expect(routeKeepsItsHost(direct("http", "http://desk.example.com/"))).toBe(false);
  });

  it("treats only loopback and LAN addresses as nearby", () => {
    expect(isNearbyAddress("http://127.0.0.1:3773/")).toBe(true);
    expect(isNearbyAddress("http://192.168.1.10:3773/")).toBe(true);
    expect(isNearbyAddress("http://100.101.102.103:3773/")).toBe(false);
    expect(isNearbyAddress("https://desk.tail1234.ts.net/")).toBe(false);
    expect(isNearbyAddress("https://desk.example.com/")).toBe(false);
    expect(isNearbyAddress("not a url")).toBe(false);
  });

  it("places a new route after faster kinds", () => {
    expect(insertRoute([TAILNET], LAN)).toEqual([LAN, TAILNET]);
    expect(insertRoute([LAN, PUBLIC], TAILNET)).toEqual([LAN, TAILNET, PUBLIC]);
  });

  it("keeps a user's order when a saved route is replaced", () => {
    const repaired = direct("lan", "http://192.168.1.11:3773/");
    expect(upsertRoute([PUBLIC, LAN], repaired)).toEqual([PUBLIC, repaired]);
  });

  it("puts a newly paired route ahead of saved routes of the same kind", () => {
    const pasted = direct("lan-2", "http://192.168.1.11:3773/");
    expect(upsertRoute([LAN, TAILNET], pasted)).toEqual([pasted, LAN, TAILNET]);
  });

  it("keeps a newly paired route behind a different kind of the same rank", () => {
    const vpn = direct("vpn", "http://100.101.102.103:3773/");
    const pasted = direct("ts-2", "http://[fd7a:115c:a1e0::2]:3773/");
    expect(upsertRoute([vpn, TAILNET], pasted)).toEqual([vpn, pasted, TAILNET]);
  });

  it("shows a dragged order only until the saved routes catch up or change", () => {
    const dragged = ["tailnet", "lan"];
    expect(pendingRouteOrder(dragged, ["lan", "tailnet"])).toBe(dragged);
    expect(pendingRouteOrder(dragged, ["tailnet", "lan"])).toBeNull();
    expect(pendingRouteOrder(dragged, ["lan", "public"])).toBeNull();
    expect(pendingRouteOrder(dragged, ["lan", "tailnet", "public"])).toBeNull();
  });
});

describe("learned routes", () => {
  it("adds the addresses the server reports as routes that borrow the paired credential", () => {
    const routes = mergeLearnedRoutes({
      entry: entryOf(PUBLIC),
      activeRoute: PUBLIC,
      reported: [
        { httpBaseUrl: "https://192.168.1.10:3773/" },
        { httpBaseUrl: "https://desk.tail1234.ts.net/", kind: "tailnet" },
      ],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual([
      `learned:${ENVIRONMENT_ID}:https://192.168.1.10:3773@public`,
      `learned:${ENVIRONMENT_ID}:https://desk.tail1234.ts.net@public`,
      "public",
    ]);
  });

  it("ignores loopback addresses the server reports", () => {
    expect(
      mergeLearnedRoutes({
        entry: entryOf(PUBLIC),
        activeRoute: PUBLIC,
        reported: [{ httpBaseUrl: "http://127.0.0.1:3773/" }],
        allowInsecure: true,
      }),
    ).toBeNull();
  });

  it("stops borrowing a credential once its route is removed", () => {
    const learned = mergeLearnedRoutes({
      entry: entryOf(PUBLIC),
      activeRoute: PUBLIC,
      reported: [{ httpBaseUrl: "https://192.168.1.10:3773/" }],
      allowInsecure: true,
    });
    expect(ids(routesAfterRemoving(learned ?? [], "public"))).toEqual([]);
  });

  it("flags a token that would travel over plain HTTP it was not paired over", () => {
    const stale = direct(
      `learned:${ENVIRONMENT_ID}:http://10.0.0.5:3773@public`,
      "http://10.0.0.5:3773/",
    );
    expect(sendsTokenInClear([stale, PUBLIC], stale)).toBe(true);
    expect(sendsTokenInClear([stale, PUBLIC], PUBLIC)).toBe(false);
  });
});
