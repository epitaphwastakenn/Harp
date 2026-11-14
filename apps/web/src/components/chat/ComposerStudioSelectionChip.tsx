import { BoxSelectIcon, XIcon } from "lucide-react";
import { ContextChip, ContextChipAction, ContextChipLabel } from "../ContextChip";

export function ComposerStudioSelectionChip(props: {
  readonly label: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="flex min-w-0 px-1 pb-1 text-sm" data-composer-studio-selection>
      <ContextChip kind="environment">
        <BoxSelectIcon aria-hidden />
        <ContextChipLabel>{props.label}</ContextChipLabel>
        <ContextChipAction
          aria-label="Do not send the Studio selection with this message"
          onClick={props.onDismiss}
        >
          <XIcon aria-hidden />
        </ContextChipAction>
      </ContextChip>
    </div>
  );
}
