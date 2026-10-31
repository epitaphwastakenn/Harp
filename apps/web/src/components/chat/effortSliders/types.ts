export type EffortSliderOption = { readonly id: string; readonly label: string };

export type EffortSliderVariantProps = {
  readonly options: ReadonlyArray<EffortSliderOption>;
  readonly value: number;
  readonly label: string;
  readonly disabled: boolean;
  readonly onPreview: (index: number) => void;
  readonly onCommit: (index: number) => void;
};
