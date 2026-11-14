import type { OrchestrationV2ApprovalStudioCode } from "@t3tools/contracts";
import { scanForSecrets, secretChipText } from "@t3tools/shared/secretScan";
import { studioCodeConsequence } from "@t3tools/shared/studioCode";
import { TriangleAlertIcon } from "lucide-react";
import { use } from "react";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { TimelineRowCtx } from "./timelineRowContext";

const fenceFor = (code: string) => {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
};

export function ApprovalStudioCode(props: { readonly code: OrchestrationV2ApprovalStudioCode }) {
  const { markdownCwd } = use(TimelineRowCtx);
  const { code } = props;
  const findings = scanForSecrets(code.code);
  const fence = fenceFor(code.code);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-approval-studio-code>
      <span className="text-muted-foreground">{studioCodeConsequence(code)}</span>
      {findings.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {findings.map((finding) => (
            <Badge key={finding.kind} variant="warning" size="sm">
              <TriangleAlertIcon aria-hidden />
              {secretChipText(finding)}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="max-h-72 min-w-0 overflow-auto [scrollbar-width:thin]">
        <ChatMarkdown text={`${fence}${code.language}\n${code.code}\n${fence}`} cwd={markdownCwd} />
      </div>
    </div>
  );
}
