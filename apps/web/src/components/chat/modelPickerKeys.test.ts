import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { modelPickerModelKey, parseModelPickerModelKey } from "./modelPickerKeys";

describe("model picker item keys", () => {
  it("keeps keys distinct when an instance name is a prefix of another instance and slug", () => {
    const first = modelPickerModelKey(ProviderInstanceId.make("ab"), "c");
    const second = modelPickerModelKey(ProviderInstanceId.make("a"), "bc");

    expect(first).not.toBe(second);
    expect(parseModelPickerModelKey(first)).toEqual({ instanceId: "ab", slug: "c" });
    expect(parseModelPickerModelKey(second)).toEqual({ instanceId: "a", slug: "bc" });
  });

  it("refuses text that is not a model key", () => {
    expect(parseModelPickerModelKey("legacy-models:codex")).toBeNull();
    expect(parseModelPickerModelKey("model:x:abc")).toBeNull();
    expect(parseModelPickerModelKey("model:9:abc")).toBeNull();
  });

  it("round-trips arbitrary strings without throwing", () => {
    const instanceId = ProviderInstanceId.make("custom");
    const slug = "model:\udfff";

    const key = modelPickerModelKey(instanceId, slug);

    expect(parseModelPickerModelKey(key)).toEqual({ instanceId, slug });
  });
});
