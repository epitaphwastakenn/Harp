import { useState } from "react";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId, TurnItemId, type SnapShotSource } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import { buildTurnImagesPreview } from "./turnImagesPreview";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const minted = AsyncResult.success({
    relativeUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  const createUrl = Atom.family((_key: string) => Atom.make(() => minted).pipe(Atom.keepAlive));
  const createUrls = Atom.family((key: string) =>
    Atom.make(() => (JSON.parse(key)[1] as ReadonlyArray<unknown>).map(() => minted)).pipe(
      Atom.keepAlive,
    ),
  );
  const actual = await original();
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: (target: { readonly input: unknown }) => createUrl(JSON.stringify(target.input)),
      createUrls: (target: { readonly environmentId: unknown; readonly resources: unknown }) =>
        createUrls(JSON.stringify([target.environmentId, target.resources])),
    },
  };
});
vi.mock(import("~/state/session"), async (original) => {
  const { Option } = await import("effect");
  const { PrimaryConnectionTarget } = await import("@t3tools/client-runtime/connection");
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("environment-1"),
    label: "Local",
    httpBaseUrl: "http://localhost:1",
    wsBaseUrl: "ws://localhost:1",
  });
  const prepared: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  return {
    ...(await original()),
    usePreparedConnection: () => Option.some(prepared),
  };
});
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));

const snapShotSource: SnapShotSource = {
  kind: "snap-shot",
  capturedAt: "2026-01-01T00:00:00.000Z",
  appName: "Finder",
  windowTitle: "Downloads",
};

const environmentId = EnvironmentId.make("environment-1");
const shots = ["a", "b", "c"].map((itemId) => ({
  _tag: "tool-output-image" as const,
  threadId: ThreadId.make("thread-1"),
  itemId: TurnItemId.make(itemId),
  index: 0,
}));

const D2_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1174 920"><rect width="1174" height="920"/></svg>';

function ImagePreviewOpener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open preview
      </button>
      {open && (
        <ExpandedImageDialog
          preview={{ images: [{ src: PIXEL, name: "shot.png", source: snapShotSource }], index: 0 }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("ExpandedImageDialog", () => {
  it.each([
    { opener: "mouse", focusVisible: false },
    { opener: "keyboard", focusVisible: true },
  ])("returns $opener focus to the opener on close", async (c) => {
    await using screen = await render(<ImagePreviewOpener />, {
      // The opener renders no links and reads no route.
      router: false,
    });
    const opener = screen.getByRole("button", { name: "Open preview" });
    if (c.opener === "mouse") {
      await userEvent.click(opener);
    } else {
      await userEvent.keyboard("{Tab}");
      await userEvent.keyboard("{Enter}");
    }
    await expect.element(page.getByRole("button", { name: "Close image preview" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(opener).toHaveFocus();
    expect(opener.element().matches(":focus-visible")).toBe(c.focusVisible);
  });

  it.each(["/work/pipeline.svg", "/work/diagram#v2.svg", "/work/diagram?v2.svg"])(
    "fits a markdown SVG without intrinsic size to the viewer: %s",
    async (path) => {
      const src = URL.createObjectURL(new Blob([D2_SVG], { type: "image/svg+xml" }));
      using _src = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };
      await using screen = await render(
        <ExpandedImageDialog
          preview={{
            images: [
              {
                src,
                name: "Pipeline",
                actionsSource: {
                  kind: "image",
                  name: "Pipeline",
                  src,
                  reference: { kind: "file", path },
                },
              },
            ],
            index: 0,
          }}
          onClose={vi.fn()}
        />,
        // The dialog renders no links and reads no route.
        { router: false },
      );

      const viewer = screen.getByRole("region", { name: "Pipeline, zoomable image" });
      const availableWidth = window.innerWidth * 0.92 - (window.innerWidth >= 640 ? 96 : 0);
      await vi.waitFor(() =>
        expect(viewer.element().getBoundingClientRect().width).toBeCloseTo(availableWidth, 0),
      );
    },
  );

  it("Escape closes a popup opened inside the dialog before the dialog", async () => {
    const onClose = vi.fn();
    await using screen = await render(
      <ExpandedImageDialog
        preview={{ images: [{ src: PIXEL, name: "shot.png", source: snapShotSource }], index: 0 }}
        onClose={onClose}
      />,
      // The dialog renders no links and reads no route.
      { router: false },
    );

    await userEvent.click(screen.getByRole("button", { name: "No accessibility data" }));
    await expect.element(screen.getByText("Accessibility data")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByText("Accessibility data")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Focus returns to the popup's trigger and opens its tooltip; leave it for a plain control.
    (screen.getByRole("button", { name: "Close image preview" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("prefetches each neighbour once, even when the other shot is both previous and next", async () => {
    await using _screen = await render(
      <ExpandedImageDialog
        preview={buildTurnImagesPreview(environmentId, shots.slice(0, 2), 0)}
        onClose={vi.fn()}
      />,
      { router: false },
    );

    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="dialog"] img.hidden')).toHaveLength(1),
    );
  });

  it("shows asset-only shots and flips through them by filmstrip, keys and swipe", async () => {
    await using _screen = await render(
      <ExpandedImageDialog
        preview={buildTurnImagesPreview(environmentId, shots, 0)}
        onClose={vi.fn()}
      />,
      { router: false },
    );
    const caption = (position: number) => page.getByText(`Screenshot (${position}/3)`);

    await expect.element(page.getByRole("img", { name: "Screenshot" })).toBeVisible();
    await expect.element(caption(1)).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Show Screenshot 3 of 3" }));
    await expect.element(caption(3)).toBeVisible();

    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(caption(2)).toBeVisible();
    await userEvent.keyboard("{Home}");
    await expect.element(caption(1)).toBeVisible();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(caption(3)).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect.element(caption(3)).toBeVisible();

    const touch = (type: string, clientX: number, clientY: number) =>
      page
        .getByRole("img", { name: "Screenshot" })
        .element()
        .dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            clientX,
            clientY,
          }),
        );
    touch("pointerdown", 300, 200);
    touch("pointerup", 200, 210);
    await expect.element(caption(1)).toBeVisible();
    touch("pointerdown", 200, 200);
    touch("pointerup", 300, 205);
    await expect.element(caption(3)).toBeVisible();
    touch("pointerdown", 200, 200);
    touch("pointerup", 215, 205);
    touch("pointerdown", 200, 200);
    touch("pointerup", 205, 330);
    await expect.element(caption(3)).toBeVisible();
  });

  it("scrolling pans the image while Ctrl+wheel zooms around the pointer", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1200;
    await using screen = await render(
      <ExpandedImageDialog
        preview={{ images: [{ src: canvas.toDataURL(), name: "large.png" }], index: 0 }}
        onClose={() => {}}
      />,
      // The dialog renders no links and reads no route.
      { router: false },
    );
    const viewportLocator = screen.getByRole("region", { name: "large.png, zoomable image" });
    const viewport = viewportLocator.element() as HTMLElement;
    const image = screen.getByRole("img", { name: "large.png" }).element() as HTMLElement;
    await vi.waitFor(() => expect(image.style.width).not.toBe(""));
    const fitWidth = image.getBoundingClientRect().width;
    const wheels: { ctrlKey: boolean; canceled: boolean }[] = [];
    const recordWheel = (event: WheelEvent) =>
      wheels.push({ ctrlKey: event.ctrlKey, canceled: event.defaultPrevented });
    document.addEventListener("wheel", recordWheel);
    using _wheelListener = {
      [Symbol.dispose]: () => document.removeEventListener("wheel", recordWheel),
    };
    // Wheels land on the viewport's center; this is the image fraction under it.
    const pointerFraction = () => {
      const viewportBounds = viewport.getBoundingClientRect();
      const imageBounds = image.getBoundingClientRect();
      return {
        x: (viewportBounds.left + viewportBounds.width / 2 - imageBounds.left) / imageBounds.width,
        y: (viewportBounds.top + viewportBounds.height / 2 - imageBounds.top) / imageBounds.height,
      };
    };
    const ctrlWheel = async (deltaY: number) => {
      await userEvent.keyboard("{Control>}");
      await userEvent.wheel(viewportLocator, { delta: { y: deltaY } });
      await userEvent.keyboard("{/Control}");
    };

    await userEvent.wheel(viewportLocator, { delta: { y: 120 } });
    expect(wheels.at(-1)).toEqual({ ctrlKey: false, canceled: false });
    expect(image.getBoundingClientRect().width).toBe(fitWidth);

    await ctrlWheel(-100);
    expect(wheels.at(-1)).toEqual({ ctrlKey: true, canceled: true });
    const zoomedWidth = image.getBoundingClientRect().width;
    expect(zoomedWidth).toBeCloseTo(fitWidth * Math.E, 0);

    const pan = async (delta: { x: number; y: number }) => {
      const { scrollLeft, scrollTop } = viewport;
      await userEvent.wheel(viewportLocator, { delta });
      await vi.waitFor(() => {
        expect(Math.sign(viewport.scrollLeft - scrollLeft)).toBe(Math.sign(delta.x));
        expect(Math.sign(viewport.scrollTop - scrollTop)).toBe(Math.sign(delta.y));
      });
    };
    await pan({ x: 60, y: 0 });
    await pan({ x: 0, y: 60 });
    await pan({ x: -40, y: -40 });
    expect(wheels.filter((wheel) => !wheel.ctrlKey).every((wheel) => !wheel.canceled)).toBe(true);
    expect(image.getBoundingClientRect().width).toBe(zoomedWidth);

    const anchor = pointerFraction();
    await ctrlWheel(-50);
    expect(image.getBoundingClientRect().width).toBeGreaterThan(zoomedWidth);
    expect(pointerFraction().x).toBeCloseTo(anchor.x, 2);
    expect(pointerFraction().y).toBeCloseTo(anchor.y, 2);
  });
});
