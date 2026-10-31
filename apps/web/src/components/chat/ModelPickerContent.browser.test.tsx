import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelCapabilities,
  type ProviderOptionSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  favorites: [] as Array<{ provider: string; model: string }>,
  toggleFavorite: vi.fn(),
}));

vi.mock(import("~/hooks/useSettings"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentModelPreferences: (() => ({ favorites: state.favorites })) as never,
  useToggleEnvironmentModelFavorite: (() => state.toggleFavorite) as never,
}));

import "~/index.css";
import { render } from "../../../test/render";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

const claudeId = ProviderInstanceId.make("claudeAgent");
const codexId = ProviderInstanceId.make("codex");
const cursorId = ProviderInstanceId.make("cursor");

const effortCaps: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "max", label: "Max" },
      ],
    },
    { id: "fastMode", label: "Fast mode", type: "boolean", description: "Lower latency" },
    {
      id: "contextWindow",
      label: "Context window",
      type: "select",
      options: [
        { id: "200k", label: "200k", isDefault: true },
        { id: "1m", label: "1M" },
      ],
    },
  ],
};

const serverModel = (
  slug: string,
  name: string,
  capabilities: ModelCapabilities | null,
  isDefault = false,
): ServerProviderModel => ({ slug, name, isCustom: false, isDefault, capabilities });

const modelsByInstance = new Map<ProviderInstanceId, ReadonlyArray<ServerProviderModel>>([
  [
    claudeId,
    [
      serverModel("haiku", "Haiku 5.5", null),
      serverModel("sonnet", "Sonnet 5.5", effortCaps, true),
      serverModel("opus", "Opus 5.5", effortCaps),
    ],
  ],
  [
    codexId,
    [serverModel("gpt-a", "GPT Alpha", effortCaps, true), serverModel("gpt-b", "GPT Beta", null)],
  ],
  [cursorId, []],
]);

const optionsByInstance = new Map(
  [...modelsByInstance].map(
    ([instanceId, models]) =>
      [instanceId, models.map(({ slug, name, isDefault }) => ({ slug, name, isDefault }))] as const,
  ),
);

function entry(
  instanceId: ProviderInstanceId,
  displayName: string,
  overrides: Partial<ProviderInstanceEntry> = {},
): ProviderInstanceEntry {
  return {
    instanceId,
    driverKind: ProviderDriverKind.make(instanceId),
    displayName,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {
      driver: ProviderDriverKind.make(instanceId),
      auth: { status: "authenticated" },
      installed: true,
      setup: { canAuthenticate: true },
    } as unknown as ServerProvider,
    models: modelsByInstance.get(instanceId) ?? [],
    ...overrides,
  };
}

const entries = [
  entry(claudeId, "Claude"),
  entry(codexId, "Codex"),
  entry(cursorId, "Cursor", {
    status: "error",
    isAvailable: false,
    snapshot: {
      driver: ProviderDriverKind.make("cursor"),
      auth: { status: "unauthenticated" },
      installed: true,
      setup: { canAuthenticate: true },
    } as unknown as ServerProvider,
  }),
];

function optionValue(options: ReadonlyArray<ProviderOptionSelection> | undefined, id: string) {
  return options?.find((option) => option.id === id)?.value ?? "none";
}

function Harness(props: { basic?: boolean; locked?: boolean }) {
  const [open, setOpen] = useState(true);
  const [instanceId, setInstanceId] = useState(claudeId);
  const [model, setModel] = useState("sonnet");
  const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection> | undefined>();
  return (
    <>
      <ProviderModelPicker
        open={open}
        onOpenChange={setOpen}
        environmentId={null}
        activeInstanceId={instanceId}
        model={model}
        lockedProvider={props.locked ? ProviderDriverKind.make("claudeAgent") : null}
        instanceEntries={entries}
        modelOptionsByInstance={optionsByInstance}
        onOpenProviderSetup={() => undefined}
        onInstanceModelChange={(nextInstanceId, nextModel) => {
          setInstanceId(nextInstanceId);
          setModel(nextModel);
          setOptions(undefined);
        }}
        {...(props.basic
          ? {}
          : {
              models: modelsByInstance.get(instanceId) ?? [],
              modelOptions: options,
              onModelOptionsChange: setOptions,
            })}
      />
      <output data-testid="selection">{`${instanceId}/${model}`}</output>
      <output data-testid="effort">{String(optionValue(options, "effort"))}</output>
      <output data-testid="fast">{String(optionValue(options, "fastMode"))}</output>
      <output data-testid="open">{String(open)}</output>
    </>
  );
}

const listbox = (name: string) => page.getByRole("listbox", { name });
const selection = () => page.getByTestId("selection");
const effort = () => page.getByTestId("effort");
const fast = () => page.getByTestId("fast");

async function setup(
  config: { width?: number; basic?: boolean; locked?: boolean; favorites?: boolean } = {},
) {
  state.favorites = config.favorites ? [{ provider: claudeId, model: "opus" }] : [];
  state.toggleFavorite.mockReset();
  await page.viewport(config.width ?? 1280, 900);
  await using stack = new AsyncDisposableStack();
  stack.use(
    await render(
      <Harness
        {...(config.basic ? { basic: true } : {})}
        {...(config.locked ? { locked: true } : {})}
      />,
    ),
  );
  await expect.element(listbox("Model")).toHaveFocus();
  const owned = stack.move();
  return { [Symbol.asyncDispose]: () => owned.disposeAsync() };
}

describe("model and reasoning picker", () => {
  it("opens on the model wheel and applies arrow-key choices right away", async () => {
    await using _screen = await setup();
    await expect.element(selection()).toHaveTextContent("claudeAgent/sonnet");

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/opus");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/haiku");
    await expect
      .element(page.getByRole("option", { name: /Haiku 5\.5/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the ends of a wheel and to a model by typing its name", async () => {
    await using _screen = await setup();

    await userEvent.keyboard("{End}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/opus");
    await userEvent.keyboard("{Home}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/haiku");
    await userEvent.keyboard("so");
    await expect.element(selection()).toHaveTextContent("claudeAgent/sonnet");
  });

  it("moves between the wheels with the arrow keys and changes the reasoning effort", async () => {
    await using _screen = await setup();

    await userEvent.keyboard("{ArrowRight}");
    await expect.element(listbox("Reasoning effort")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(effort()).toHaveTextContent("max");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    await expect.element(effort()).toHaveTextContent("medium");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect.element(listbox("Provider")).toHaveFocus();
  });

  it("picks a reasoning level with the number keys", async () => {
    await using _screen = await setup();

    await userEvent.keyboard("1");
    await expect.element(effort()).toHaveTextContent("low");
  });

  it("moves one item for one mouse wheel notch, however far it was spun", async () => {
    await using _screen = await setup();
    const wheel = (deltaY: number) =>
      listbox("Model")
        .element()
        .dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));

    wheel(100);
    await expect.element(selection()).toHaveTextContent("claudeAgent/opus");
    wheel(-4000);
    await expect.element(selection()).toHaveTextContent("claudeAgent/sonnet");
  });

  it("drags a wheel and settles on the nearest item", async () => {
    await using _screen = await setup();

    await userEvent.dragAndDrop(
      page.getByRole("option", { name: /Sonnet 5.5/ }),
      page.getByRole("option", { name: /Opus 5.5/ }),
    );
    await expect.element(selection()).toHaveTextContent("claudeAgent/haiku");
  });

  it("skips a provider that a started thread is locked out of", async () => {
    await using _screen = await setup({ locked: true });

    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/sonnet");
    await expect
      .element(page.getByRole("option", { name: /Codex/ }).getByText("Locked"))
      .toBeVisible();
  });

  it("selects an item that is clicked", async () => {
    await using _screen = await setup();

    await userEvent.click(page.getByRole("option", { name: /Haiku 5\.5/ }));
    await expect.element(selection()).toHaveTextContent("claudeAgent/haiku");
  });

  it("switches provider with its wheel and explains a provider that needs sign-in", async () => {
    await using _screen = await setup();

    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    await expect.element(selection()).toHaveTextContent("codex/gpt-a");
    await expect.element(page.getByRole("option", { name: /GPT Beta/ })).toBeInTheDocument();

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("button", { name: "Open provider setup" })).toBeVisible();
    await expect.element(selection()).toHaveTextContent("codex/gpt-a");
    await expect
      .element(page.getByRole("option", { name: /Cursor/ }).getByText("Sign in"))
      .toBeVisible();
  });

  it("offers Favorites first and lists only the favourite models in it", async () => {
    await using _screen = await setup({ favorites: true });

    await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/opus");
    await expect
      .element(page.getByRole("option", { name: /Opus/ }).getByText("Claude"))
      .toBeVisible();
    await expect.element(page.getByRole("option", { name: /Haiku 5\.5/ })).not.toBeInTheDocument();
  });

  it("flips the model switches and resets everything but the model", async () => {
    await using _screen = await setup();
    const reset = page.getByRole("button", { name: "Reset" });
    await expect.element(reset).toBeDisabled();

    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    await userEvent.click(page.getByRole("switch", { name: /Fast mode/ }));
    await expect.element(fast()).toHaveTextContent("true");
    await expect.element(effort()).toHaveTextContent("max");
    await expect.element(reset).toBeEnabled();

    await userEvent.click(reset);
    await expect.element(effort()).toHaveTextContent("none");
    await expect.element(fast()).toHaveTextContent("none");
    await expect.element(selection()).toHaveTextContent("claudeAgent/sonnet");
  });

  it("searches every model and applies the top result", async () => {
    await using _screen = await setup();

    await userEvent.click(page.getByRole("button", { name: "Search models" }));
    await userEvent.keyboard("gpt b");
    await expect.element(selection()).toHaveTextContent("codex/gpt-b");

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByTestId("open")).toHaveTextContent("true");
    await expect.element(listbox("Model")).toHaveFocus();
  });

  it("closes on Enter and on Escape", async () => {
    {
      await using _screen = await setup();
      await userEvent.keyboard("{Enter}");
      await expect.element(page.getByTestId("open")).toHaveTextContent("false");
    }
    {
      await using _screen = await setup();
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByTestId("open")).toHaveTextContent("false");
    }
  });

  it("stacks the reasoning choices under two wheels on a narrow screen", async () => {
    await using _screen = await setup({ width: 380 });

    await expect.element(listbox("Reasoning effort")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(listbox("Model")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(listbox("Provider")).toHaveFocus();
    await userEvent.click(page.getByRole("button", { name: "Max" }));
    await expect.element(effort()).toHaveTextContent("max");
  });

  it("holds a chosen model until it is confirmed when the picker has no reasoning options", async () => {
    await using _screen = await setup({ basic: true });

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(selection()).toHaveTextContent("claudeAgent/sonnet");
    await userEvent.click(page.getByRole("button", { name: "Select" }));
    await expect.element(selection()).toHaveTextContent("claudeAgent/opus");
    await expect.element(page.getByTestId("open")).toHaveTextContent("false");
  });
});
